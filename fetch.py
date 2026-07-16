#!/usr/bin/env python3
"""
freetvco - IPTV stream fetcher for Cò TiVi
Fetches encrypted channel/sport data from api.cotivi.site,
decrypts with BlowFish (pycryptodome), and generates M3U playlist.

APK analysis:
  - Bundle  : Hermes bytecode (React Native / Expo SDK 52)
  - Crypto  : CryptoJS.Blowfish + AnsiX923 padding (found in string table)
  - API     : https://api.cotivi.site/api/{Channels,Sports}?version=<ver>
  - Response: { "key": "<base64>", "data": "<base64-encrypted>" }
"""

import base64, hashlib, json, os, sys, urllib.request, zlib
from pathlib import Path

# ── optional pycryptodome ─────────────────────────────────────────────────────
try:
    from Crypto.Cipher import Blowfish
    from Crypto.Util.Padding import unpad
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False
    print("⚠  pycryptodome not found — install with: pip install pycryptodome")

# ── config ────────────────────────────────────────────────────────────────────
API_BASE = "https://api.cotivi.site"
VERSION  = os.environ.get("COTIVI_VERSION", "1.1.2")
OUT_DIR  = Path(os.environ.get("OUT_DIR",   "output"))
DBG_DIR  = Path(os.environ.get("DEBUG_DIR", "debug"))

ENDPOINTS = [
    {"name": "channels", "path": "/api/Channels", "outFile": "cotivi_channels.m3u", "group": "CoTiVi TV"},
    {"name": "sports",   "path": "/api/Sports",   "outFile": "cotivi_sports.m3u",   "group": "CoTiVi Sports"},
]

# ── helpers ───────────────────────────────────────────────────────────────────

def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Cò TiVi/1.1.7"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def ansi_x923_unpad(data: bytes, block_size: int) -> bytes:
    """ANSI X923 padding: pad bytes are 0x00, last byte is pad length."""
    pad_len = data[-1]
    if pad_len == 0 or pad_len > block_size:
        return data
    if any(b != 0 for b in data[-(pad_len):-1]):
        return data  # not valid ANSI X923
    return data[:-pad_len]


def zero_unpad(data: bytes) -> bytes:
    return data.rstrip(b'\x00')


def pkcs7_unpad(data: bytes, block_size: int) -> bytes:
    pad_len = data[-1]
    if pad_len == 0 or pad_len > block_size:
        return data
    if data[-pad_len:] != bytes([pad_len] * pad_len):
        return data
    return data[:-pad_len]


def try_decrypt(key_str: str, enc_b64: str):
    """
    Try every combination of mode/padding/IV until we get valid JSON.
    Returns (parsed_data, config_description) or (None, None).
    """
    if not HAS_CRYPTO:
        return None, None

    enc_data = base64.b64decode(enc_b64)
    BS = Blowfish.block_size  # 8 bytes

    # Key variants
    keys = [
        key_str.encode(),
        key_str.lower().encode(),
        hashlib.md5(key_str.encode()).digest(),          # raw 16 bytes
        hashlib.md5(key_str.encode()).hexdigest().encode(),
        hashlib.sha1(key_str.encode()).digest(),          # raw 20 bytes
        b"cotivi",
        b"MyTV",
        b"com.cofvuong.tivi",
    ]

    # IV variants (8 bytes each)
    ivs = [
        b"\x00" * 8,
        key_str[:8].encode().ljust(8, b"\x00"),
        b"12345678",
        b"cotivi00",
        b"\x00\x00\x00\x00\x00\x00\x00\x01",
    ]

    unpads = [
        ("AnsiX923",    lambda d: ansi_x923_unpad(d, BS)),
        ("ZeroPad",     zero_unpad),
        ("Pkcs7",       lambda d: pkcs7_unpad(d, BS)),
        ("NoPad",       lambda d: d),
    ]

    modes_cbc = [(Blowfish.MODE_CBC, iv) for iv in ivs]
    modes_ecb = [(Blowfish.MODE_ECB, None)]

    for key in keys:
        for mode_id, iv in modes_cbc + modes_ecb:
            for pad_name, unpad_fn in unpads:
                try:
                    if mode_id == Blowfish.MODE_CBC:
                        cipher = Blowfish.new(key, mode_id, iv)
                    else:
                        cipher = Blowfish.new(key, mode_id)

                    raw = cipher.decrypt(enc_data)
                    raw = unpad_fn(raw)

                    # Try as-is
                    for attempt in [raw, raw.lstrip(b"\x00")]:
                        if attempt and attempt[0] in (ord("{"), ord("[")):
                            text = attempt.decode("utf-8", errors="replace")
                            parsed = json.loads(text)
                            cfg = f"key={key[:16]!r} mode={'CBC' if mode_id==Blowfish.MODE_CBC else 'ECB'} pad={pad_name} iv={iv!r}"
                            print(f"  ✅ Decrypt OK: {cfg}")
                            return parsed, cfg

                    # Try zlib inflate
                    try:
                        inflated = zlib.decompress(raw)
                        if inflated and inflated[0] in (ord("{"), ord("[")):
                            parsed = json.loads(inflated.decode("utf-8"))
                            cfg = f"key={key[:16]!r} mode=CBC+zlib pad={pad_name}"
                            print(f"  ✅ Decrypt+Inflate OK: {cfg}")
                            return parsed, cfg
                    except Exception:
                        pass

                except Exception:
                    pass

    return None, None


# ── M3U builder ───────────────────────────────────────────────────────────────

URL_FIELDS = ["url", "streamUrl", "stream_url", "link", "playUrl", "liveUrl",
              "stream", "hls", "rtmp", "src", "source"]

def pick_url(ch: dict) -> str:
    for f in URL_FIELDS:
        if ch.get(f):
            return ch[f]
    return next((v for v in ch.values()
                 if isinstance(v, str) and v.startswith("http")), "")


def build_m3u(channels: list, group_title: str = "CoTiVi") -> str:
    lines = ['#EXTM3U url-tvg="https://lichphatsong.site/schedule/epg.xml.gz"']
    for ch in channels:
        name  = ch.get("name") or ch.get("title") or ch.get("channelName") or "Unknown"
        logo  = ch.get("logo") or ch.get("icon") or ch.get("thumbnail") or ""
        group = ch.get("group") or ch.get("category") or ch.get("groupName") or group_title
        cid   = ch.get("id") or ch.get("channelId") or name.lower().replace(" ", "-")
        url   = pick_url(ch)
        if not url:
            continue
        lines.append(f'#EXTINF:-1 tvg-id="{cid}" tvg-name="{name}" tvg-logo="{logo}" group-title="{group}",{name}')
        lines.append(url)
    return "\n".join(lines) + "\n"


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DBG_DIR.mkdir(parents=True, exist_ok=True)

    all_channels = []
    decrypt_ok   = False

    for ep in ENDPOINTS:
        url = f"{API_BASE}{ep['path']}?version={VERSION}"
        print(f"\n📡 Fetching {ep['name']}: {url}")

        try:
            resp = fetch_json(url)
        except Exception as e:
            print(f"  ❌ Fetch error: {e}")
            continue

        # Save raw response
        (DBG_DIR / f"{ep['name']}_raw.json").write_text(json.dumps(resp, indent=2, ensure_ascii=False))

        if "key" not in resp or "data" not in resp:
            print(f"  ❌ Unexpected response format: {list(resp.keys())}")
            continue

        key_str = base64.b64decode(resp["key"]).decode("utf-8")
        data_b64 = resp["data"]
        enc_size = len(base64.b64decode(data_b64))
        print(f"  🔑 Key decoded : {key_str!r} ({len(key_str)} chars)")
        print(f"  📦 Encrypted   : {enc_size:,} bytes")

        data, cfg = try_decrypt(key_str, data_b64)

        if data is None:
            print(f"  ❌ All decrypt attempts failed.")
            print(f"     Raw response saved → debug/{ep['name']}_raw.json")
            print(f"     Next step: decompile Hermes bundle with hermes-dec, or intercept live traffic.")
            continue

        decrypt_ok = True
        channels = data if isinstance(data, list) else (
            data.get("channels") or data.get("data") or data.get("items") or [])

        print(f"  📺 {len(channels)} entries decrypted")

        # Save sample for inspection
        (DBG_DIR / f"{ep['name']}_decrypted_sample.json").write_text(
            json.dumps(channels[:3], indent=2, ensure_ascii=False))

        if not channels:
            print("  ⚠  No channel entries found in decrypted data")
            (DBG_DIR / f"{ep['name']}_decrypted_full.json").write_text(
                json.dumps(data, indent=2, ensure_ascii=False))
            continue

        m3u = build_m3u(channels, ep["group"])
        out_path = OUT_DIR / ep["outFile"]
        out_path.write_text(m3u, encoding="utf-8")
        print(f"  ✅ Saved → {out_path}")

        for ch in channels:
            ch["_group"] = ep["group"]
        all_channels.extend(channels)

    # Combined
    if all_channels:
        combined = build_m3u(all_channels, "CoTiVi")
        (OUT_DIR / "cotivi_all.m3u").write_text(combined, encoding="utf-8")
        print(f"\n📋 Combined: {len(all_channels)} channels → output/cotivi_all.m3u")

    if not decrypt_ok:
        print("\n❌ Decryption failed for all endpoints.")
        print("   Likely cause: hardcoded BlowFish IV/key inside Hermes bytecode")
        print("   → Use hermes-dec to decompile bundle, or mitmproxy to intercept traffic")
        sys.exit(1)

    print("\n✅ Done!")


if __name__ == "__main__":
    main()
