# freetvco 🇻🇳

Tự động fetch và giải mã danh sách kênh IPTV từ app **Cò TiVi** (com.cofvuong.tivi v1.1.7).

## 📺 Playlist

| File | Nội dung |
|------|----------|
| [`output/cotivi_all.m3u`](output/cotivi_all.m3u) | Tất cả kênh (Channels + Sports) |
| [`output/cotivi_channels.m3u`](output/cotivi_channels.m3u) | Chỉ kênh TV |
| [`output/cotivi_sports.m3u`](output/cotivi_sports.m3u) | Chỉ kênh thể thao |

> **Cập nhật tự động mỗi 6 tiếng** qua GitHub Actions.

## 🔓 Kết quả reverse-engineering APK

### Encryption (đã crack)

| Thông số | Giá trị |
|----------|---------|
| Algorithm | **AES-256-ECB** |
| Padding | **PKCS7** |
| Key (Channels) | `6677150266771502cotivichatvkl321` |
| Key (Sports) | `6677150266771502cotivichatvkl999` |

### API

```
GET https://api.cotivi.site/api/Channels?version=1.1.2
GET https://api.cotivi.site/api/Sports?version=1.1.2

Response: {
  "key": "VHVvaUxvekdpYWlNYU5oZUhqSGo=",  ← base64 "TuoiLozGiaiMaNheHjHj" (troll key, bỏ qua)
  "data": "<base64 AES-ECB ciphertext>"
}
```

### Cách tìm ra key

1. Dùng **hermes-dec** để decompile Hermes bytecode (`assets/index.android.bundle` trong APK)
2. Tìm hàm `giaimane` (fn#11130, fn#11461) — tiếng Việt nghĩa là "giải mã"
3. Hàm này load `LoadConstString: '6677150266771502cotivichatvkl999'` rồi gọi `CryptoJS.AES.decrypt` với mode ECB, padding Pkcs7

```
Fn #11130 'giaimane':
  LoadConstString  string_id: 2013  → '6677150266771502cotivichatvkl999'
  GetById          string_id: 8914  → 'AES'
  GetById          string_id: 7361  → 'ECB'
  GetById          string_id: 12647 → 'Pkcs7'
  GetById          string_id: 15666 → 'decrypt'
```

## 🚀 Tự chạy

```bash
pip install pycryptodome
python3 fetch.py
```

Playlist sẽ được tạo trong `output/`.

## 🔑 DRM / ClearKey

98 kênh trong API `Channels` là MPEG-DASH (`.mpd`) hoặc HLS mã hoá bằng
**ClearKey**. App gốc trả sẵn cặp `kid`/`k` (base64url 16-byte) trong field
`clearkey.keys[]` cho 96 kênh; 2 kênh `VTV7`/`VTV8` phải query license server
`https://api.cotivi.site/drm/a.php?channel=vtv9` runtime.

`fetch.py` tự:

- Decode `clearkey.keys[]` → hex.
- Với kênh thiếu clearkey (VTV7/VTV8), gọi `drmOptions.licenseServer` để lấy key.
- Ghi vào M3U theo định dạng Kodi `inputstream.adaptive`:

  ```
  #KODIPROP:inputstream.adaptive.license_type=clearkey
  #KODIPROP:inputstream.adaptive.license_key=<kid_hex>:<k_hex>[|<kid2>:<k2>...]
  ```

  Với kênh có nhiều cặp key (video + audio), các cặp nối bằng `|`.

> ⚠️ Player phải hỗ trợ `inputstream.adaptive` (Kodi 19+ với InputStream
> Adaptive, hoặc IPTV Smarters Pro / TiviMate mới). VLC thường không chơi
> được ClearKey-DASH qua M3U.

## 📁 Cấu trúc

```
freetvco/
├── fetch.py              # Script chính (AES-256-ECB decrypt)
├── output/
│   ├── cotivi_all.m3u    # Playlist tổng hợp
│   ├── cotivi_channels.m3u
│   └── cotivi_sports.m3u
└── debug/
    ├── channels_raw.json       # Response mã hoá từ API
    ├── channels_decrypted.json # JSON đã giải mã
    ├── sports_raw.json
    └── sports_decrypted.json
```
