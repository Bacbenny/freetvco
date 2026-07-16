# freetvco 📺

Tự động lấy danh sách kênh IPTV từ **Cò TiVi** (`api.cotivi.site`) và tạo file M3U playlist.  
Chạy mỗi 6 tiếng qua GitHub Actions → commit playlist mới vào repo.

## Playlist

| File | Mô tả |
|---|---|
| [`output/cotivi_channels.m3u`](output/cotivi_channels.m3u) | Kênh TV thường |
| [`output/cotivi_sports.m3u`](output/cotivi_sports.m3u) | Kênh thể thao |
| [`output/cotivi_all.m3u`](output/cotivi_all.m3u) | Tất cả kênh (gộp) |

> Dùng link `raw.githubusercontent.com/...` để import vào VLC, TiviMate, Kodi, v.v.

---

## Kỹ thuật

### Kết quả phân tích APK Cò TiVi v1.1.7

| Thông tin | Chi tiết |
|---|---|
| Package | `com.cofvuong.tivi` |
| Framework | React Native / Expo SDK 52 |
| Bundle | Hermes bytecode (compiled, không đọc trực tiếp) |
| API Base | `https://api.cotivi.site` |
| Runtime Version | `1.1.2` |
| Player | react-native-video + ExoPlayer |
| Hỗ trợ stream | HLS (`.m3u8`), RTMP, DASH, SmoothStreaming |

### API

```
GET https://api.cotivi.site/api/Channels?version=1.1.2
GET https://api.cotivi.site/api/Sports?version=1.1.2
```

**Response:**
```json
{
  "key":  "VHVvaUxvekdpYWlNYU5oZUhqSGo=",
  "data": "<base64 BlowFish-encrypted JSON>"
}
```

`key` (base64-decoded) = `TuoiLozGiaiMaNheHjHj` → dùng làm BlowFish key.

**Encryption:** `CryptoJS.Blowfish` · Padding `AnsiX923`  
*(Xác nhận qua phân tích Hermes string table của bundle)*

### Tìm hiểu thêm

Bundle `index.android.bundle` là **Hermes bytecode** → cần `hermes-dec` để decompile và
tìm IV/key hardcoded chính xác. Trong thời gian chờ, workflow tự thử tất cả
combination mode/padding/IV phổ biến.

**Workaround nếu decrypt vẫn fail:** chạy APK trên Android emulator với `mitmproxy` để
intercept response đã decrypt ở runtime.

---

## Chạy local

```bash
npm install
node fetch.js
# → output/ sẽ có các file .m3u
```

## Cấu trúc

```
freetvco/
├── .github/workflows/update.yml   # GitHub Actions (mỗi 6h)
├── fetch.js                        # Script chính
├── package.json
├── output/                         # Playlist M3U (auto-generated)
│   ├── cotivi_channels.m3u
│   ├── cotivi_sports.m3u
│   └── cotivi_all.m3u
└── debug/                          # Raw API response (để debug)
    ├── channels_raw.json
    └── sports_raw.json
```
