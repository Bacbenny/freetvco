#!/usr/bin/env python3
"""
freetvco – IPTV stream fetcher for Cò TiVi
============================================
Reverse-engineered from APK: com.cofvuong.tivi v1.1.7 (Hermes bytecode)

Encryption (confirmed via hermes-dec disassembly):
  Algorithm : AES-256-ECB / PKCS7
  Key/Channels : 6677150266771502cotivichatvkl321  (32 bytes)
  Key/Sports   : 6677150266771502cotivichatvkl999  (32 bytes)
  Key/Signature: vuongdeptraivuongdeptraivklvkl12 (32 bytes)

  The app computes a `co-signature` HTTP header by AES-256-ECB encrypting
  JSON {ipData, firtTime, lastTime} with the signature key above.
  rd.locket.top redirector requires this header to return a real M3U8.
  We resolve the redirect at build time and embed the CDN URL directly.

API:
  GET https://api.cotivi.site/api/Channels?version=1.1.2
  GET https://api.cotivi.site/api/Sports?version=1.1.2

Channel health check:
  - 200 / 206 / 302 / 403 → keep  (403 = IP-restricted CDN, works from Vietnam)
  - 400 / 404 / DNS-fail  → skip  (genuinely dead)
  - timeout               → keep  (might be Replit-side issue)

Sports strategy:
  - ALL matches included (live + upcoming) so users see the full schedule
  - Live matches: real stream URL fetched from fetchApi
  - Upcoming matches: fetchApi URL shown (players can retry when match starts)
"""

import base64, json, os, re, ssl, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse

try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad, pad
except ImportError:
    sys.exit("❌  pip install pycryptodome")

# ── config ────────────────────────────────────────────────────────────────────
API_BASE        = "https://api.cotivi.site"
VERSION         = os.environ.get("COTIVI_VERSION", "1.1.2")
OUT_DIR         = Path(os.environ.get("OUT_DIR",   "output"))
DBG_DIR         = Path(os.environ.get("DEBUG_DIR", "debug"))
HEALTH_CHECK    = os.environ.get("HEALTH_CHECK", "true").lower() == "true"
SPORT_WORKERS   = int(os.environ.get("SPORT_WORKERS",  "20"))
HEALTH_WORKERS  = int(os.environ.get("HEALTH_WORKERS", "30"))
SPORT_TIMEOUT   = int(os.environ.get("SPORT_TIMEOUT",  "12"))
HEALTH_TIMEOUT  = int(os.environ.get("HEALTH_TIMEOUT", "10"))
RESOLVE_TIMEOUT = int(os.environ.get("RESOLVE_TIMEOUT", "15"))
RESOLVE_WORKERS = int(os.environ.get("RESOLVE_WORKERS", "10"))

# AES-256-ECB key for the co-signature header (reverse-engineered from Hermes bytecode)
SIG_KEY = b"vuongdeptraivuongdeptraivklvkl12"

# Domains whose URLs need the co-signature header to resolve
SIGN_DOMAINS = {"rd.locket.top"}

ENDPOINTS = [
    {
        "name"    : "channels",
        "path"    : "/api/Channels",
        "key"     : b"6677150266771502cotivichatvkl321",
        "outFile" : "cotivi_channels.m3u",
        "label"   : "📺 Channels",
    },
    {
        "name"    : "sports",
        "path"    : "/api/Sports",
        "key"     : b"6677150266771502cotivichatvkl999",
        "outFile" : "cotivi_sports.m3u",
        "label"   : "⚽ Sports",
    },
]

# Domains that are IP-restricted to Vietnam — always keep regardless of test result
VN_CDN_DOMAINS = {
    "live.fptplay53.net", "live-a.fptplay53.net",
    "liveatmvng.vtvprime.vn", "livebytatm.vtvprime.vn", "livezenatm.vtvprime.vn",
    "liveh34.vtvprime.vn",
    "live.baoquangninh.vn", "tv.angiangtv.vn",
    "live.truyenhinhnghean.vn", "vtvgolive-sctv.vtvdigital.vn",
    "livevlisctcdnw.seenow.vn",
    "rd.locket.top",
}

# ── helpers ───────────────────────────────────────────────────────────────────

def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Cò TiVi/1.1.7"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def decrypt_aes_ecb(b64_data: str, key: bytes) -> dict:
    raw    = base64.b64decode(b64_data)
    cipher = AES.new(key, AES.MODE_ECB)
    plain  = unpad(cipher.decrypt(raw), AES.block_size)
    return json.loads(plain.decode("utf-8"))


def _b64url_hex(s: str) -> str:
    """Decode base64url 16-byte key/KID → lowercase hex (no separators)."""
    if not s:
        return ""
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad).hex()


def fetch_clearkey_license(license_server: str, timeout: int = 10) -> list:
    """Query a cotivi license server, return list of {kid_hex, k_hex}."""
    try:
        req = urllib.request.Request(
            license_server,
            headers={"User-Agent": "Cò TiVi/1.1.7", "Referer": "https://giovang.link"},
        )
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx()) as r:
            data = json.loads(r.read())
        out = []
        for k in data.get("keys", []):
            kid = _b64url_hex(k.get("kid", ""))
            key = _b64url_hex(k.get("k", ""))
            if kid and key:
                out.append({"kid_hex": kid, "k_hex": key})
        return out
    except Exception:
        return []


def build_clearkey_props(ch: dict) -> list:
    """
    Return list of M3U property lines for a DRM ClearKey channel.
    Uses embedded clearkey if present; otherwise queries drmOptions.licenseServer.
    """
    drm = ch.get("drmOptions") or {}
    if drm.get("type") != "clearkey":
        return []

    pairs = []
    ck = ch.get("clearkey")
    if isinstance(ck, dict) and ck.get("keys"):
        for k in ck["keys"]:
            kid = _b64url_hex(k.get("kid", ""))
            key = _b64url_hex(k.get("k", ""))
            if kid and key:
                pairs.append((kid, key))

    if not pairs and drm.get("licenseServer"):
        for k in fetch_clearkey_license(drm["licenseServer"]):
            pairs.append((k["kid_hex"], k["k_hex"]))

    if not pairs:
        return []

    license_key = "|".join(f"{kid}:{key}" for kid, key in pairs)
    return [
        "#KODIPROP:inputstream.adaptive.license_type=clearkey",
        f"#KODIPROP:inputstream.adaptive.license_key={license_key}",
    ]


def _ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode    = ssl.CERT_NONE
    return ctx


# ── co-signature & rd.locket.top resolution ───────────────────────────────────

_ip_cache: dict | None = None


def _get_ip_data() -> dict:
    """Fetch IP info once per run (cached)."""
    global _ip_cache
    if _ip_cache is not None:
        return _ip_cache
    try:
        req = urllib.request.Request(
            "https://ipinfo.io/json",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        with urllib.request.urlopen(req, timeout=10, context=_ssl_ctx()) as r:
            _ip_cache = json.loads(r.read())
    except Exception:
        _ip_cache = {}
    return _ip_cache


def make_co_signature() -> str:
    """
    Generate the co-signature header value.
    AES-256-ECB encrypt JSON {ipData, firtTime, lastTime} with SIG_KEY, return base64.
    """
    ip_data = _get_ip_data()
    ts = str(int(time.time() * 1000))
    payload = json.dumps({"ipData": ip_data, "firtTime": ts, "lastTime": ts})
    cipher = AES.new(SIG_KEY, AES.MODE_ECB)
    encrypted = cipher.encrypt(pad(payload.encode("utf-8"), AES.block_size))
    return base64.b64encode(encrypted).decode("utf-8")


def resolve_locket_url(ch: dict, signature: str) -> str:
    """
    Resolve a rd.locket.top redirector URL to the real CDN stream URL.
    Fetches the M3U8 with the co-signature header and extracts the first variant URL.
    Returns the CDN URL, or "" on failure (caller keeps the original link).
    """
    link = ch.get("link", "")
    hdr = ch.get("header", {})
    headers = {"User-Agent": "Mozilla/5.0", "co-signature": signature}
    if isinstance(hdr, dict):
        for k, v in hdr.items():
            if k.lower() == "user-agent":
                headers["User-Agent"] = v
            else:
                headers[k] = v
    try:
        req = urllib.request.Request(link, headers=headers)
        with urllib.request.urlopen(req, timeout=RESOLVE_TIMEOUT, context=_ssl_ctx()) as r:
            body = r.read(4096).decode("utf-8", errors="replace")
        urls = re.findall(r"(https?://[^\s]+\.m3u8)", body)
        if urls:
            return urls[0]
    except Exception:
        pass
    return ""


def check_stream(ch: dict) -> bool:
    """
    Return True if the channel stream should be kept.
    IP-restricted VN CDN domains always pass.
    HTTP 400/404 and DNS failures are skipped.
    DRM channels (onDrm / drmOptions) always pass (can't health-check .mpd).
    Redirectors returning 200 with "error signature" body are skipped.
    """
    url = ch.get("link", "")
    if not url:
        return False
    if ch.get("onDrm") or ch.get("drmOptions") or ch.get("clearkey"):
        return True
    domain = urlparse(url).netloc
    if domain in VN_CDN_DOMAINS:
        return True            # IP-restricted, works from Vietnam
    hdr = ch.get("header", {})
    ua  = (hdr.get("User-agent") or hdr.get("user-agent", "")) if isinstance(hdr, dict) else ""
    headers = {"User-Agent": ua or "Mozilla/5.0"}
    if isinstance(hdr, dict):
        for k, v in hdr.items():
            if k.lower() not in ("user-agent",):
                headers[k] = v
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=HEALTH_TIMEOUT, context=_ssl_ctx()) as r:
            body = r.read(256)
            if r.status in (400, 404):
                return False
            low = body.lower()
            if b"error signature" in low or b"error sign" in low:
                return False
            if b"<html" in low and b"#extm3u" not in low and b".m3u8" not in low:
                return False
            return True
    except urllib.error.HTTPError as e:
        return e.code not in (400, 403, 404)
    except urllib.error.URLError as e:
        reason = str(e.reason)
        if "Name or service not known" in reason or "Errno -2" in reason:
            return False
        return True
    except Exception:
        return True


def fetch_sport_url(ch: dict) -> str:
    """
    Fetch live stream URL from fetchApi.
    Returns stream URL string or "" if not live / unavailable.
    """
    fetch_api = ch.get("fetchApi", "")
    if not fetch_api:
        return ""
    try:
        req = urllib.request.Request(fetch_api, headers={"User-Agent": "Cò TiVi/1.1.7"})
        with urllib.request.urlopen(req, timeout=SPORT_TIMEOUT) as r:
            data = json.loads(r.read())
        if not data.get("status"):
            return ""
        default = data.get("default", {})
        url = default.get("url", "")
        if not url:
            links = data.get("streamLink", [])
            url = links[0].get("url", "") if links else ""
        return url
    except Exception:
        return ""


# ── M3U builders ──────────────────────────────────────────────────────────────

def make_channels_m3u(data_json: dict, skip_ids: set, resolved: dict) -> tuple:
    """Build M3U for channels, optionally filtering dead streams.
    `resolved` maps channel id → resolved CDN URL for rd.locket.top channels."""
    lines = ["#EXTM3U"]
    kept = skipped = 0
    for group in data_json.get("Data", []):
        grp = group.get("Kenh", "Unknown")
        for ch in group.get("List", []):
            link = ch.get("link", "")
            if not link or not link.startswith("http"):
                continue
            if ch.get("id", "") in skip_ids:
                skipped += 1
                continue
            name = ch.get("name") or ch.get("id", "Unknown")
            icon = ch.get("icon", "")
            hdr  = ch.get("header", {})
            ua   = (hdr.get("User-agent") or hdr.get("user-agent", "")) if isinstance(hdr, dict) else ""
            # Use resolved CDN URL if available, otherwise keep original link
            stream_url = resolved.get(ch.get("id", ""), link)
            lines.append(
                f'#EXTINF:-1 tvg-id="{ch.get("id","")}" '
                f'tvg-name="{name}" tvg-logo="{icon}" '
                f'group-title="{grp}",{name}'
            )
            if ua:
                lines.append(f"#EXTVLCOPT:http-user-agent={ua}")
            for prop in build_clearkey_props(ch):
                lines.append(prop)
            lines.append(stream_url)
            kept += 1
    return "\n".join(lines) + "\n", kept, skipped


def make_sports_m3u(data_json: dict) -> tuple:
    """
    Build M3U for sports — ALL matches (live + upcoming).
    Live matches get real stream URLs; upcoming use fetchApi as placeholder.
    """
    all_items = []
    for group in data_json.get("Data", []):
        grp = group.get("Kenh", "Unknown")
        for ch in group.get("List", []):
            all_items.append((grp, ch))

    live_items = [(grp, ch) for grp, ch in all_items if ch.get("live")]
    print(f"  {len(all_items)} total matches, {len(live_items)} currently live")

    # Fetch real stream URLs for live matches in parallel
    stream_map = {}
    if live_items:
        print(f"  Fetching {len(live_items)} live stream URLs...")
        with ThreadPoolExecutor(max_workers=SPORT_WORKERS) as ex:
            futs = {ex.submit(fetch_sport_url, ch): (grp, ch) for grp, ch in live_items}
            for fut in as_completed(futs):
                grp, ch = futs[fut]
                stream_map[id(ch)] = fut.result()
        ok = sum(1 for u in stream_map.values() if u)
        print(f"  ✅ {ok}/{len(live_items)} live streams fetched")

    lines = ["#EXTM3U"]
    live_count = upcoming_count = 0

    for grp, ch in all_items:
        is_live    = bool(ch.get("live"))
        home       = ch.get("home", "")
        away       = ch.get("away", "")
        sport_name = (ch.get("name") or "").strip()
        display    = f"{home} vs {away}" if home and away else sport_name
        icon       = ch.get("homeLogo") or ch.get("awayLogo") or ch.get("icon", "")
        blv        = (ch.get("blv") or "").strip()
        day        = (ch.get("onlyDay") or "").strip()
        t          = (ch.get("onlyTime") or "").strip()
        time_str   = f"{day} {t}".strip()

        if is_live:
            stream_url = stream_map.get(id(ch), "")
            if not stream_url:
                stream_url = ch.get("fetchApi", "")
            status_tag = "🔴 LIVE"
            live_count += 1
        else:
            stream_url = ch.get("fetchApi", "")
            status_tag = f"⏰ {time_str}" if time_str else "⏰"
            upcoming_count += 1

        if not stream_url:
            continue

        title = display
        if time_str and not is_live:
            title = f"[{time_str}] {display}"
        if blv:
            title += f" | {blv}"
        title = f"{status_tag} | {title}"

        ch_id = ch.get("id", "")
        lines.append(
            f'#EXTINF:-1 tvg-id="{ch_id}" '
            f'tvg-name="{title}" tvg-logo="{icon}" '
            f'group-title="{grp}",{title}'
        )
        lines.append(stream_url)

    return "\n".join(lines) + "\n", live_count, upcoming_count


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DBG_DIR.mkdir(parents=True, exist_ok=True)

    all_lines = ["#EXTM3U"]
    all_count = 0

    for ep in ENDPOINTS:
        url = f"{API_BASE}{ep['path']}?version={VERSION}"
        print(f"\n{ep['label']} → {url}")

        try:
            resp = fetch_json(url)
        except Exception as e:
            print(f"  ❌ Fetch failed: {e}")
            continue

        raw_path = DBG_DIR / f"{ep['name']}_raw.json"
        raw_path.write_text(json.dumps(resp, ensure_ascii=False, indent=2), encoding="utf-8")

        key_field = base64.b64decode(resp.get("key", "")).decode("utf-8", errors="replace")
        print(f"  key_field: {key_field!r} | data: {len(base64.b64decode(resp['data']))} bytes")

        try:
            plain = decrypt_aes_ecb(resp["data"], ep["key"])
        except Exception as e:
            print(f"  ❌ Decrypt failed: {e}")
            continue

        dec_path = DBG_DIR / f"{ep['name']}_decrypted.json"
        dec_path.write_text(json.dumps(plain, ensure_ascii=False, indent=2), encoding="utf-8")

        if ep["name"] == "sports":
            m3u_content, live_c, upcoming_c = make_sports_m3u(plain)
            count = live_c + upcoming_c
            print(f"  ✅ {live_c} live + {upcoming_c} upcoming = {count} entries → {ep['outFile']}")
        else:
            # Resolve rd.locket.top redirector URLs to real CDN URLs
            locket_chs = [ch for grp in plain.get("Data",[]) for ch in grp.get("List",[])
                          if "rd.locket.top" in ch.get("link", "")]
            resolved: dict = {}
            if locket_chs:
                print(f"  Resolving {len(locket_chs)} rd.locket.top channels...")
                signature = make_co_signature()
                with ThreadPoolExecutor(max_workers=RESOLVE_WORKERS) as ex:
                    futs = {ex.submit(resolve_locket_url, ch, signature): ch for ch in locket_chs}
                    for fut in as_completed(futs):
                        ch = futs[fut]
                        cdn_url = fut.result()
                        if cdn_url:
                            resolved[ch.get("id", "")] = cdn_url
                print(f"  ✅ Resolved {len(resolved)}/{len(locket_chs)} redirector URLs")

            # Health check channels
            skip_ids: set = set()
            if HEALTH_CHECK:
                all_chs = [ch for grp in plain.get("Data",[]) for ch in grp.get("List",[])
                           if ch.get("link","").startswith("http")]
                print(f"  Health checking {len(all_chs)} channels...")
                with ThreadPoolExecutor(max_workers=HEALTH_WORKERS) as ex:
                    futs = {ex.submit(check_stream, ch): ch for ch in all_chs}
                    for fut in as_completed(futs):
                        ch = futs[fut]
                        if not fut.result():
                            skip_ids.add(ch.get("id",""))
                print(f"  Filtered {len(skip_ids)} dead channels")

            m3u_content, kept, skipped = make_channels_m3u(plain, skip_ids, resolved)
            count = kept
            print(f"  ✅ {kept} alive | {skipped} removed → {ep['outFile']}")

        out_path = OUT_DIR / ep["outFile"]
        out_path.write_text(m3u_content, encoding="utf-8")

        for line in m3u_content.split("\n")[1:]:
            if line.strip():
                all_lines.append(line)
        all_count += count

    if all_count > 0:
        all_m3u  = "\n".join(all_lines) + "\n"
        all_path = OUT_DIR / "cotivi_all.m3u"
        all_path.write_text(all_m3u, encoding="utf-8")
        vn_now = datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M %Z")
        print(f"\n✅ Combined: {all_count} entries → {all_path}  [{vn_now}]")
    else:
        print("\n❌ No entries generated")
        sys.exit(1)


if __name__ == "__main__":
    main()
