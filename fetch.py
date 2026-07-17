#!/usr/bin/env python3
"""
freetvco – IPTV stream fetcher for Cò TiVi
============================================
Reverse-engineered from APK: com.cofvuong.tivi v1.1.7 (Hermes bytecode)

Encryption (confirmed via hermes-dec disassembly of Fn#11130/11461 'giaimane'):
  Algorithm : AES-256-ECB
  Padding   : PKCS7
  Key/Channels : 6677150266771502cotivichatvkl321  (32 bytes)
  Key/Sports   : 6677150266771502cotivichatvkl999  (32 bytes)

API:
  GET https://api.cotivi.site/api/Channels?version=1.1.2
  GET https://api.cotivi.site/api/Sports?version=1.1.2
  Response: { "key": "<base64 troll>", "data": "<base64 AES-ECB ciphertext>" }

Sports channels use fetchApi to get live stream URLs dynamically.
Only items with live=true have active streams.
"""

import base64, json, os, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime, timezone, timedelta

# ── pycryptodome ──────────────────────────────────────────────────────────────
try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad
except ImportError:
    sys.exit("\u274c  pip install pycryptodome")

# ── config ────────────────────────────────────────────────────────────────────
API_BASE = "https://api.cotivi.site"
VERSION  = os.environ.get("COTIVI_VERSION", "1.1.2")
OUT_DIR  = Path(os.environ.get("OUT_DIR",   "output"))
DBG_DIR  = Path(os.environ.get("DEBUG_DIR", "debug"))
SPORT_WORKERS = int(os.environ.get("SPORT_WORKERS", "20"))
SPORT_TIMEOUT = int(os.environ.get("SPORT_TIMEOUT", "12"))

# Keys extracted from Hermes bytecode (fn#11130 'giaimane', fn#11138 '?anon_0_')
ENDPOINTS = [
    {
        "name"    : "channels",
        "path"    : "/api/Channels",
        "key"     : b"6677150266771502cotivichatvkl321",
        "outFile" : "cotivi_channels.m3u",
        "label"   : "\U0001f4fa Channels",
    },
    {
        "name"    : "sports",
        "path"    : "/api/Sports",
        "key"     : b"6677150266771502cotivichatvkl999",
        "outFile" : "cotivi_sports.m3u",
        "label"   : "\u26bd Sports",
    },
]

# ── helpers ───────────────────────────────────────────────────────────────────

def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "C\xf2 TiVi/1.1.7"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def decrypt_aes_ecb(b64_data: str, key: bytes) -> dict:
    """AES-256-ECB + PKCS7 — matches CryptoJS call in the app's giaimane()."""
    raw    = base64.b64decode(b64_data)
    cipher = AES.new(key, AES.MODE_ECB)
    plain  = unpad(cipher.decrypt(raw), AES.block_size)
    return json.loads(plain.decode("utf-8"))


def fetch_sport_stream(ch: dict) -> tuple:
    """
    Fetch live stream URL for a sports item via fetchApi.
    Returns (stream_url, user_agent). Empty strings if not available.
    
    Sports items use fetchApi which returns:
      {"status": true, "default": {"url": "<stream>"}, "streamLink": [...]}
    Items not yet live return status=False (\u201cCh\u01b0a di\u1ec5n ra tr\u1eadn \u0111\u1ea5u!\u201d).
    """
    # Only fetch for items marked as live
    if not ch.get("live"):
        return "", ""
    fetch_api = ch.get("fetchApi", "")
    if not fetch_api:
        return "", ""
    try:
        req = urllib.request.Request(fetch_api, headers={"User-Agent": "C\xf2 TiVi/1.1.7"})
        with urllib.request.urlopen(req, timeout=SPORT_TIMEOUT) as r:
            data = json.loads(r.read())
        if not data.get("status"):
            return "", ""
        default = data.get("default", {})
        url = default.get("url", "")
        if not url:
            links = data.get("streamLink", [])
            url = links[0].get("url", "") if links else ""
        hdr = ch.get("header") or ch.get("headertuget") or {}
        ua  = (hdr.get("User-agent") or hdr.get("user-agent", "")) if isinstance(hdr, dict) else ""
        return url, ua
    except Exception as e:
        print(f"    \u26a0\ufe0f  fetchApi failed for {ch.get('name', '?')} [{ch.get('id', '')[:20]}]: {e}")
        return "", ""


def make_channels_m3u(data_json: dict) -> str:
    """Build M3U for regular channels (direct link field)."""
    lines = ["#EXTM3U"]
    for group in data_json.get("Data", []):
        grp = group.get("Kenh", "Unknown")
        for ch in group.get("List", []):
            link = ch.get("link", "")
            if not link or not link.startswith("http"):
                continue
            name = ch.get("name") or ch.get("id", "Unknown")
            icon = ch.get("icon", "")
            hdr  = ch.get("header", {})
            ua   = (hdr.get("User-agent") or hdr.get("user-agent", "")) if isinstance(hdr, dict) else ""
            lines.append(
                f'#EXTINF:-1 tvg-id="{ch.get("id","")}" '
                f'tvg-name="{name}" tvg-logo="{icon}" '
                f'group-title="{grp}",{name}'
            )
            if ua:
                lines.append(f"#EXTVLCOPT:http-user-agent={ua}")
            lines.append(link)
    return "\n".join(lines) + "\n"


def make_sports_m3u(data_json: dict) -> str:
    """
    Build M3U for sports (live matches only).
    Fetches stream URLs via fetchApi in parallel.
    """
    # Collect all items across groups, keep group reference
    all_items = []
    for group in data_json.get("Data", []):
        grp = group.get("Kenh", "Unknown")
        for ch in group.get("List", []):
            all_items.append((grp, ch))

    live_items = [(grp, ch) for grp, ch in all_items if ch.get("live")]
    total = len(all_items)
    live  = len(live_items)
    print(f"  {total} total sport items, {live} currently live — fetching streams...")

    if not live_items:
        print("  \u26a0\ufe0f  No live sport matches right now.")
        return "#EXTM3U\n"

    # Fetch stream URLs in parallel
    url_map = {}
    with ThreadPoolExecutor(max_workers=SPORT_WORKERS) as ex:
        futs = {ex.submit(fetch_sport_stream, ch): (grp, ch) for grp, ch in live_items}
        for fut in as_completed(futs):
            grp, ch = futs[fut]
            url_map[id(ch)] = (grp,) + fut.result()

    ok = sum(1 for _, u, _ in url_map.values() if u)
    print(f"  \u2705 {ok}/{live} live streams fetched successfully")

    lines = ["#EXTM3U"]
    for grp_orig, ch in all_items:
        entry = url_map.get(id(ch))
        if not entry:
            continue
        grp_fetched, url, ua = entry
        if not url:
            continue
        home = ch.get("home", "")
        away = ch.get("away", "")
        name = ch.get("name") or ch.get("id", "Unknown")
        display = f"{home} vs {away}" if home and away else name
        icon = ch.get("homeLogo") or ch.get("awayLogo") or ch.get("icon", "")
        blv  = ch.get("blv", "")
        time_str = f"{ch.get('onlyDay','')} {ch.get('onlyTime','')}".strip()
        title = f"{display} [{time_str}]" if time_str else display
        if blv:
            title += f" – {blv}"
        lines.append(
            f'#EXTINF:-1 tvg-id="{ch.get("id","")}" '
            f'tvg-name="{title}" tvg-logo="{icon}" '
            f'group-title="{grp_orig}",{title}'
        )
        if ua:
            lines.append(f"#EXTVLCOPT:http-user-agent={ua}")
        lines.append(url)
    return "\n".join(lines) + "\n"


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DBG_DIR.mkdir(parents=True, exist_ok=True)

    vn_now   = datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M %Z")
    all_lines = ["#EXTM3U"]
    all_count = 0

    for ep in ENDPOINTS:
        url = f"{API_BASE}{ep['path']}?version={VERSION}"
        print(f"\n{ep['label']} \u2192 {url}")

        try:
            resp = fetch_json(url)
        except Exception as e:
            print(f"  \u274c Fetch failed: {e}")
            continue

        raw_path = DBG_DIR / f"{ep['name']}_raw.json"
        raw_path.write_text(json.dumps(resp, ensure_ascii=False, indent=2), encoding="utf-8")

        key_field = base64.b64decode(resp.get("key", "")).decode("utf-8", errors="replace")
        print(f"  key_field (troll) : {key_field!r}")
        print(f"  data size         : {len(base64.b64decode(resp['data']))} bytes")

        try:
            plain = decrypt_aes_ecb(resp["data"], ep["key"])
        except Exception as e:
            print(f"  \u274c Decrypt failed: {e}")
            continue

        dec_path = DBG_DIR / f"{ep['name']}_decrypted.json"
        dec_path.write_text(json.dumps(plain, ensure_ascii=False, indent=2), encoding="utf-8")

        if ep["name"] == "sports":
            m3u_content = make_sports_m3u(plain)
        else:
            m3u_content = make_channels_m3u(plain)

        count = m3u_content.count("#EXTINF")
        print(f"  \u2705 Generated — {count} entries")

        out_path = OUT_DIR / ep["outFile"]
        out_path.write_text(m3u_content, encoding="utf-8")
        print(f"  \U0001f4c4 {out_path}")

        for line in m3u_content.split("\n")[1:]:
            if line.strip():
                all_lines.append(line)
        all_count += count

    if all_count > 0:
        all_m3u  = "\n".join(all_lines) + "\n"
        all_path = OUT_DIR / "cotivi_all.m3u"
        all_path.write_text(all_m3u, encoding="utf-8")
        print(f"\n\u2705 Combined: {all_count} total entries \u2192 {all_path}")
    else:
        print("\n\u274c No entries generated")
        sys.exit(1)


if __name__ == "__main__":
    main()
