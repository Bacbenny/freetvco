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
"""

import base64, json, os, sys, urllib.request
from pathlib import Path
from datetime import datetime, timezone, timedelta

# ── pycryptodome ──────────────────────────────────────────────────────────────
try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad
except ImportError:
    sys.exit("❌  pip install pycryptodome")

# ── config ────────────────────────────────────────────────────────────────────
API_BASE = "https://api.cotivi.site"
VERSION  = os.environ.get("COTIVI_VERSION", "1.1.2")
OUT_DIR  = Path(os.environ.get("OUT_DIR",   "output"))
DBG_DIR  = Path(os.environ.get("DEBUG_DIR", "debug"))

# Keys extracted from Hermes bytecode (fn#11130 'giaimane', fn#11138 '?anon_0_')
ENDPOINTS = [
    {
        "name"    : "channels",
        "path"    : "/api/Channels",
        "key"     : b"6677150266771502cotivichatvkl321",   # 32 bytes → AES-256
        "outFile" : "cotivi_channels.m3u",
        "label"   : "📺 Channels",
    },
    {
        "name"    : "sports",
        "path"    : "/api/Sports",
        "key"     : b"6677150266771502cotivichatvkl999",   # 32 bytes → AES-256
        "outFile" : "cotivi_sports.m3u",
        "label"   : "⚽ Sports",
    },
]

# ── helpers ───────────────────────────────────────────────────────────────────

def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Cò TiVi/1.1.7"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def decrypt_aes_ecb(b64_data: str, key: bytes) -> dict:
    """AES-256-ECB + PKCS7 — matches CryptoJS call in the app's giaimane()."""
    raw    = base64.b64decode(b64_data)
    cipher = AES.new(key, AES.MODE_ECB)
    plain  = unpad(cipher.decrypt(raw), AES.block_size)
    return json.loads(plain.decode("utf-8"))


def make_m3u(data_json: dict, group_prefix: str = "") -> str:
    lines = ["#EXTM3U"]
    for group in data_json.get("Data", []):
        grp = group.get("Kenh", "Unknown")
        for ch in group.get("List", []):
            link = ch.get("link", "")
            if not link or not link.startswith("http"):
                # Sports entries without a direct link (need separate token fetch)
                continue
            name = ch.get("name") or ch.get("id", "Unknown")
            icon = ch.get("icon", "")
            hdr  = ch.get("header", {})
            ua   = hdr.get("User-agent") or hdr.get("user-agent", "")
            lines.append(
                f'#EXTINF:-1 tvg-id="{ch.get("id","")}" '
                f'tvg-name="{name}" tvg-logo="{icon}" '
                f'group-title="{grp}",{name}'
            )
            if ua:
                lines.append(f"#EXTVLCOPT:http-user-agent={ua}")
            lines.append(link)
    return "\n".join(lines) + "\n"


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    DBG_DIR.mkdir(parents=True, exist_ok=True)

    vn_now = datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M %Z")
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

        # Save raw encrypted response for debugging
        raw_path = DBG_DIR / f"{ep['name']}_raw.json"
        raw_path.write_text(json.dumps(resp, ensure_ascii=False, indent=2), encoding="utf-8")

        key_field = base64.b64decode(resp.get("key", "")).decode("utf-8", errors="replace")
        print(f"  key_field (troll) : {key_field!r}")
        print(f"  data size         : {len(base64.b64decode(resp['data']))} bytes")

        try:
            plain = decrypt_aes_ecb(resp["data"], ep["key"])
        except Exception as e:
            print(f"  ❌ Decrypt failed: {e}")
            continue

        # Save decrypted JSON
        dec_path = DBG_DIR / f"{ep['name']}_decrypted.json"
        dec_path.write_text(json.dumps(plain, ensure_ascii=False, indent=2), encoding="utf-8")

        m3u_content = make_m3u(plain)
        count = m3u_content.count("#EXTINF")
        print(f"  ✅ Decrypted — {count} channels")

        # Write per-endpoint M3U
        out_path = OUT_DIR / ep["outFile"]
        out_path.write_text(m3u_content, encoding="utf-8")
        print(f"  📄 {out_path}")

        # Append to combined (skip header line)
        for line in m3u_content.split("\n")[1:]:
            if line.strip():
                all_lines.append(line)
        all_count += count

    # Write combined M3U
    if all_count > 0:
        all_m3u = "\n".join(all_lines) + "\n"
        all_path = OUT_DIR / "cotivi_all.m3u"
        all_path.write_text(all_m3u, encoding="utf-8")
        print(f"\n✅ Combined: {all_count} channels → {all_path}")
    else:
        print("\n❌ No channels decrypted")
        sys.exit(1)


if __name__ == "__main__":
    main()
