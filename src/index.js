// dekiiptv95 — v1.1.4
// Fixes: remove SCTV Test + Thử Nghiệm, move Lạng Sơn to Địa Phương,
//        new title format for Giờ Vàng & Tiếu Lâm, proxy TV360 streams

var API_BASE = "https://api.cotivi.site";
var VERSION = "1.1.2";
var CACHE_TTL_MS = 5 * 60 * 1e3;
var KV_TTL_SEC = 10 * 60;
var CHANNELS_KEY_STR = "6677150266771502cotivichatvkl321";
var SPORTS_KEY_STR = "6677150266771502cotivichatvkl999";
var REALTIME_GROUPS = new Set(["Giờ Vàng", "Tiếu Lâm"]);
var ALLOWED_HOSTS = new Set(["pay.locket.top", "rd.locket.top", "api.cotivi.site"]);
var GROUP_CONFIG = [
  ["Giờ Vàng", ["Giờ Vàng"]],
  ["Tiếu Lâm", ["Tiếu Lâm"]],
  ["VTV", ["VTV"]],
  ["Thiết Yếu", ["Thiết Yếu"]],
  ["VTVCab", ["VTVCab Thể Thao", "VTVCab"]],
  ["SCTV", ["SCTV Thể Thao", "SCTV"]],
  ["HTV", ["HTV"]],
  ["In The Box", ["In The Box"]],
  ["Nước Ngoài", ["Nước Ngoài"]],
  ["Địa Phương", ["Địa Phương", "THVL"]],
  ["Sự Kiện VTVPrime", ["Sự Kiện VTVPrime"]],
  ["Sự Kiện TV360", ["Sự Kiện TV360"]]
];
var EXCLUDE_GROUPS = new Set(["World Cup", "WorldCup Nước Ngoài", "SCTV Test", "Thử Nghiệm", "Thử nghiệm"]);
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
var SBOX = new Uint8Array([
  99,124,119,123,242,107,111,197,48,1,103,43,254,215,171,118,202,130,201,125,250,89,71,240,173,212,162,175,156,164,114,192,183,253,147,38,54,63,247,204,52,165,229,241,113,216,49,21,4,199,35,195,24,150,5,154,7,18,128,226,235,39,178,117,9,131,44,26,27,110,90,160,82,59,214,179,41,227,47,132,83,209,0,237,32,252,177,91,106,203,190,57,74,76,88,207,208,239,170,251,67,77,51,133,69,249,2,127,80,60,159,168,81,163,64,143,146,157,56,245,188,182,218,33,16,255,243,210,205,12,19,236,95,151,68,23,196,167,126,61,100,93,25,115,96,129,79,220,34,42,144,136,70,238,184,20,222,94,11,219,224,50,58,10,73,6,36,92,194,211,172,98,145,149,228,121,231,200,55,109,141,213,78,169,108,86,244,234,101,122,174,8,186,120,37,46,28,166,180,198,232,221,116,31,75,189,139,138,112,62,181,102,72,3,246,14,97,53,87,185,134,193,29,158,225,248,152,17,105,217,142,148,155,30,135,233,206,85,40,223,140,161,137,13,191,230,66,104,65,153,45,15,176,84,187,22
]);
var RCON = new Uint8Array([1,2,4,8,16,32,64,128,27,54,108,216,171,77]);
var INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

function keyExpansion(key) {
  const Nk = key.length / 4;
  const Nr = Nk + 6;
  const w = new Uint8Array(16 * (Nr + 1));
  w.set(key);
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t0 = w[(i - 1) * 4], t1 = w[(i - 1) * 4 + 1], t2 = w[(i - 1) * 4 + 2], t3 = w[(i - 1) * 4 + 3];
    if (i % Nk === 0) {
      const tmp = t0;
      t0 = SBOX[t1] ^ RCON[i / Nk - 1];
      t1 = SBOX[t2]; t2 = SBOX[t3]; t3 = SBOX[tmp];
    } else if (Nk > 6 && i % Nk === 4) {
      t0 = SBOX[t0]; t1 = SBOX[t1]; t2 = SBOX[t2]; t3 = SBOX[t3];
    }
    w[i * 4] = w[(i - Nk) * 4] ^ t0;
    w[i * 4 + 1] = w[(i - Nk) * 4 + 1] ^ t1;
    w[i * 4 + 2] = w[(i - Nk) * 4 + 2] ^ t2;
    w[i * 4 + 3] = w[(i - Nk) * 4 + 3] ^ t3;
  }
  return { w, Nr };
}
function xtime(x) { return (x << 1 ^ (x & 128 ? 27 : 0)) & 255; }
function mul(x, y) {
  let r = 0;
  for (let i = 0; i < 8; i++) { if (y & 1) r ^= x; x = xtime(x); y >>= 1; }
  return r;
}
function subBytes(s) { for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]]; }
function invSubBytes(s) { for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]]; }
function shiftRows(s) {
  let t = s[1]; s[1] = s[5]; s[5] = s[9]; s[9] = s[13]; s[13] = t;
  t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[15]; s[15] = s[11]; s[11] = s[7]; s[7] = s[3]; s[3] = t;
}
function invShiftRows(s) {
  let t = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = t;
  t = s[2]; s[2] = s[10]; s[10] = t; t = s[6]; s[6] = s[14]; s[14] = t;
  t = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = t;
}
function mixColumns(s) {
  for (let c = 0; c < 4; c++) {
    const i = c * 4, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
    s[i] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3;
    s[i + 1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3;
    s[i + 2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3);
    s[i + 3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2);
  }
}
function invMixColumns(s) {
  for (let c = 0; c < 4; c++) {
    const i = c * 4, a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
    s[i] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
    s[i + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
    s[i + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
    s[i + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
  }
}
function addRoundKey(s, w, round) { for (let i = 0; i < 16; i++) s[i] ^= w[round * 16 + i]; }
function encryptBlock(block, ek) {
  const s = new Uint8Array(block);
  addRoundKey(s, ek.w, 0);
  for (let r = 1; r < ek.Nr; r++) { subBytes(s); shiftRows(s); mixColumns(s); addRoundKey(s, ek.w, r); }
  subBytes(s); shiftRows(s); addRoundKey(s, ek.w, ek.Nr);
  return s;
}
function decryptBlock(block, ek) {
  const s = new Uint8Array(block);
  addRoundKey(s, ek.w, ek.Nr);
  for (let r = ek.Nr - 1; r >= 1; r--) { invShiftRows(s); invSubBytes(s); addRoundKey(s, ek.w, r); invMixColumns(s); }
  invShiftRows(s); invSubBytes(s); addRoundKey(s, ek.w, 0);
  return s;
}
function decryptAesEcb(ciphertext, keyBytes) {
  const ek = keyExpansion(keyBytes);
  const n = ciphertext.length / 16;
  const out = new Uint8Array(ciphertext.length);
  for (let i = 0; i < n; i++) out.set(decryptBlock(ciphertext.subarray(i * 16, (i + 1) * 16), ek), i * 16);
  const pad = out[out.length - 1];
  if (pad >= 1 && pad <= 16) return out.subarray(0, out.length - pad);
  return out;
}
function encryptAesEcb(plaintext, keyBytes) {
  const ek = keyExpansion(keyBytes);
  const padLen = 16 - plaintext.length % 16;
  const padded = new Uint8Array(plaintext.length + padLen);
  padded.set(plaintext);
  padded.fill(padLen, plaintext.length);
  const n = padded.length / 16;
  const out = new Uint8Array(padded.length);
  for (let i = 0; i < n; i++) out.set(encryptBlock(padded.subarray(i * 16, (i + 1) * 16), ek), i * 16);
  return out;
}
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64urlHex(s) {
  if (!s) return "";
  const pad = "=".repeat((4 - s.length % 4) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  let hex = "";
  for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
}
var SIG_KEY_STR = "vuongdeptraivuongdeptraivklvkl12";
async function makeCoSignature() {
  const ts = String(Date.now());
  const payload = JSON.stringify({ ipData: {}, firtTime: ts, lastTime: ts });
  const enc = encryptAesEcb(new TextEncoder().encode(payload), new TextEncoder().encode(SIG_KEY_STR));
  return bytesToBase64(enc);
}
var _keyCache = {};
function getKeyBytes(keyStr) {
  if (!_keyCache[keyStr]) _keyCache[keyStr] = new TextEncoder().encode(keyStr);
  return _keyCache[keyStr];
}
async function fetchEndpoint(path, keyStr) {
  const url = `${API_BASE}${path}?version=${VERSION}`;
  const res = await fetch(url, { headers: { "User-Agent": "Cò TiVi/1.1.7" } });
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  const json = await res.json();
  const decrypted = decryptAesEcb(base64ToBytes(json.data), getKeyBytes(keyStr));
  return JSON.parse(new TextDecoder().decode(decrypted));
}
async function buildClearkeyProps(ch) {
  const drm = ch.drmOptions || {};
  if (drm.type !== "clearkey") return [];
  const pairs = [];
  if (ch.clearkey?.keys) {
    for (const k of ch.clearkey.keys) {
      const kid = b64urlHex(k.kid || "");
      const key = b64urlHex(k.k || "");
      if (kid && key) pairs.push([kid, key]);
    }
  }
  if (pairs.length === 0 && drm.licenseServer) {
    try {
      const r = await fetch(drm.licenseServer, { headers: { "User-Agent": "Cò TiVi/1.1.7", "Referer": "https://giovang.link" } });
      if (r.ok) {
        const data = await r.json();
        for (const k of data.keys || []) {
          const kid = b64urlHex(k.kid || "");
          const key = b64urlHex(k.k || "");
          if (kid && key) pairs.push([kid, key]);
        }
      }
    } catch {}
  }
  if (pairs.length === 0) return [];
  const licenseKey = pairs.map(([kid, key]) => `${kid}:${key}`).join("|");
  return [
    "#KODIPROP:inputstream.adaptive.license_type=clearkey",
    `#KODIPROP:inputstream.adaptive.license_key=${licenseKey}`
  ];
}
function rewriteStreamUrl(rawUrl, workerOrigin) {
  if (!rawUrl) return "";
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes("supabase.co") && u.pathname.includes("resolve-stream")) {
      const innerUrl = u.searchParams.get("url");
      if (innerUrl) return `${workerOrigin}/?url=${encodeURIComponent(innerUrl)}`;
    }
  } catch {}
  try {
    const u = new URL(rawUrl);
    if (ALLOWED_HOSTS.has(u.hostname)) return `${workerOrigin}/?url=${encodeURIComponent(rawUrl)}`;
  } catch {}
  return rawUrl;
}
function isTv360Url(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.hostname === "api.cotivi.site" && (u.pathname.includes("tv360.m3u8") || u.pathname.includes("tv360.mpd"));
  } catch { return false; }
}
function rewriteTv360Url(rawUrl, workerOrigin) {
  try {
    const u = new URL(rawUrl);
    const id = u.searchParams.get("id") || "";
    const ext = u.pathname.endsWith(".mpd") ? "mpd" : "m3u8";
    return `${workerOrigin}/tv360/${ext}?id=${encodeURIComponent(id)}`;
  } catch { return rawUrl; }
}
async function buildChannelsM3U(data, workerOrigin) {
  const lines = ["#EXTM3U"];
  let count = 0;
  for (const group of data.Data || []) {
    const grp = group.Kenh || "Unknown";
    for (const ch of group.List || []) {
      const link = ch.link || "";
      if (!link || !link.startsWith("http")) continue;
      const name = ch.name || ch.id || "Unknown";
      let effectiveGrp = grp;
      if (name === "Lạng Sơn") effectiveGrp = "Địa Phương";
      const icon = ch.icon || "";
      const hdr = ch.header || {};
      const ua = hdr["User-agent"] || hdr["user-agent"] || "";
      const ref = hdr["Referer"] || hdr["referer"] || "";
      let finalLink = link;
      if (isTv360Url(link)) finalLink = rewriteTv360Url(link, workerOrigin);
      else finalLink = rewriteStreamUrl(link, workerOrigin);
      lines.push(`#EXTINF:-1 tvg-id="${ch.id || ""}" tvg-name="${name}" tvg-logo="${icon}" group-title="${effectiveGrp}",${name}`);
      if (ref) lines.push(`#EXTVLCOPT:http-referrer=${ref}`);
      if (ua) lines.push(`#EXTVLCOPT:http-user-agent=${ua}`);
      const props = await buildClearkeyProps(ch);
      for (const p of props) lines.push(p);
      lines.push(finalLink);
      count++;
    }
  }
  return { lines, count };
}
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return Infinity;
  const m = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!m) return Infinity;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}
function parseDayToDate(dayStr) {
  if (!dayStr) return Infinity;
  const m = dayStr.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return Infinity;
  let day = parseInt(m[1]);
  let month = parseInt(m[2]);
  let year = m[3] ? parseInt(m[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  return year * 10000 + month * 100 + day;
}
function buildSportsM3U(data, workerOrigin) {
  const lines = ["#EXTM3U"];
  let count = 0;
  const allEntries = [];
  for (const group of data.Data || []) {
    const grp = group.Kenh || "Unknown";
    for (const ch of group.List || []) {
      const home = ch.home || "";
      const away = ch.away || "";
      const sportName = (ch.name || "").trim();
      const icon = ch.homeLogo || ch.awayLogo || ch.icon || "";
      const blv = (ch.blv || "").trim();
      const day = (ch.onlyDay || "").trim();
      const t = (ch.onlyTime || "").trim();
      const fetchApiUrl = ch.fetchApi || "";
      let streamUrl = "";
      if (REALTIME_GROUPS.has(grp) && fetchApiUrl) {
        streamUrl = `${workerOrigin}/?url=${encodeURIComponent(fetchApiUrl)}`;
      } else {
        streamUrl = rewriteStreamUrl(fetchApiUrl, workerOrigin);
      }
      if (!streamUrl) continue;
      let matchName = home && away ? `${home} VS ${away}` : sportName;
      let parts = [];
      if (t && day) parts.push(`${t} - ${day}`);
      else if (t) parts.push(t);
      else if (day) parts.push(day);
      parts.push(matchName);
      if (blv) {
        const blvClean = blv.replace("BLV ", "").replace("BLV", "").trim();
        if (blvClean) parts.push(`BLV ${blvClean}`);
      }
      const league = sportName.replace(/^[\p{Emoji}\s]+/u, "").trim();
      if (league && league !== ch.home && league !== ch.away && !(home && away)) {
        // sportName IS the match name, skip league
      } else if (league && league !== matchName) {
        parts.push(league);
      }
      const title = parts.join(" | ");
      const hdr = ch.header || {};
      const ua = hdr["User-agent"] || hdr["user-agent"] || "";
      const ref = hdr["Referer"] || hdr["referer"] || "";
      const entryLines = [];
      entryLines.push(`#EXTINF:-1 tvg-id="${ch.id || ""}" tvg-name="${title}" tvg-logo="${icon}" group-title="${grp}",${title}`);
      if (ref) entryLines.push(`#EXTVLCOPT:http-referrer=${ref}`);
      if (ua) entryLines.push(`#EXTVLCOPT:http-user-agent=${ua}`);
      entryLines.push(streamUrl);
      allEntries.push({ lines: entryLines, grp, day, t, sortKey: parseDayToDate(day) * 1000000 + parseTimeToMinutes(t) });
    }
  }
  const SORT_GROUPS = new Set(["Giờ Vàng", "Tiếu Lâm"]);
  const grouped = {};
  for (const e of allEntries) (grouped[e.grp] ||= []).push(e);
  const seen = new Set();
  for (const group of data.Data || []) {
    const grp = group.Kenh || "Unknown";
    if (seen.has(grp)) continue;
    seen.add(grp);
    let entries = grouped[grp] || [];
    if (SORT_GROUPS.has(grp)) {
      entries = [...entries].sort((a, b) => a.sortKey - b.sortKey);
    }
    for (const entry of entries) {
      for (const l of entry.lines) lines.push(l);
      count++;
    }
  }
  return { lines, count };
}
function filterExcludedGroups(lines) {
  const filtered = [];
  let skip = false;
  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      const m = line.match(/group-title="([^"]*)"/);
      skip = m ? EXCLUDE_GROUPS.has(m[1]) : false;
    }
    if (!skip) filtered.push(line);
  }
  return filtered;
}
function reorderGroups(lines) {
  if (!lines.length) return lines;
  const header = [];
  const body = [];
  for (const line of lines) {
    if (line.startsWith("#EXTM3U")) header.push(line);
    else body.push(line);
  }
  const buckets = {};
  let cur = null;
  for (const line of body) {
    if (line.startsWith("#EXTINF")) {
      const m = line.match(/group-title="([^"]*)"/);
      cur = m ? m[1] : "Unknown";
    }
    (buckets[cur || "Unknown"] ||= []).push(line);
  }
  const relabel = (line, g) => line.startsWith("#EXTINF") ? line.replace(/group-title="[^"]*"/, `group-title="${g}"`) : line;
  const ordered = [...header];
  for (const [target, sources] of GROUP_CONFIG) {
    for (const src of sources) {
      for (const line of buckets[src] || []) ordered.push(relabel(line, target));
      delete buckets[src];
    }
  }
  for (const rem of Object.values(buckets)) ordered.push(...rem);
  return ordered;
}
async function buildM3U(workerOrigin, playlistId) {
  const [channelsData, sportsData] = await Promise.all([
    fetchEndpoint("/api/Channels", CHANNELS_KEY_STR).catch((e) => { console.error("Channels:", String(e)); return null; }),
    fetchEndpoint("/api/Sports", SPORTS_KEY_STR).catch((e) => { console.error("Sports:", String(e)); return null; })
  ]);
  if (!channelsData && !sportsData) throw new Error("Both API endpoints failed");
  let lines = [];
  let count = 0;
  if (playlistId === "channels" && channelsData) {
    const r = await buildChannelsM3U(channelsData, workerOrigin);
    lines = r.lines;
    lines = filterExcludedGroups(lines);
    lines = reorderGroups(lines);
    count = lines.filter((l) => l.startsWith("#EXTINF")).length;
  } else if (playlistId === "sports" && sportsData) {
    const r = buildSportsM3U(sportsData, workerOrigin);
    lines = r.lines;
    lines = filterExcludedGroups(lines);
    lines = reorderGroups(lines);
    count = lines.filter((l) => l.startsWith("#EXTINF")).length;
  } else {
    lines = ["#EXTM3U"];
    if (channelsData) {
      const r = await buildChannelsM3U(channelsData, workerOrigin);
      for (const l of r.lines.slice(1)) if (l.trim()) lines.push(l);
    }
    if (sportsData) {
      const r = buildSportsM3U(sportsData, workerOrigin);
      for (const l of r.lines.slice(1)) if (l.trim()) lines.push(l);
    }
    lines = filterExcludedGroups(lines);
    lines = reorderGroups(lines);
    count = lines.filter((l) => l.startsWith("#EXTINF")).length;
  }
  if (count === 0) throw new Error("No entries generated");
  return { m3uContent: lines.join("\n") + "\n", count };
}
async function getCache(cache, key) {
  const r = await cache.match(key);
  if (!r) return null;
  try {
    const wrapped = await r.json();
    if (Date.now() - wrapped.ts < CACHE_TTL_MS) return wrapped.content;
  } catch {}
  return null;
}
async function setCache(cache, key, content) {
  const wrapped = JSON.stringify({ ts: Date.now(), content });
  await cache.put(key, new Response(wrapped, {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL_MS / 1e3}` }
  }));
}
async function getKV(env, key) {
  if (!env.M3U_CACHE) return null;
  try {
    const raw = await env.M3U_CACHE.get(key, { type: "json" });
    if (!raw) return null;
    if (Date.now() - raw.ts < KV_TTL_SEC * 1e3) return raw.content;
  } catch {}
  return null;
}
async function setKV(env, key, content) {
  if (!env.M3U_CACHE) return;
  try {
    await env.M3U_CACHE.put(key, JSON.stringify({ ts: Date.now(), content }), { expirationTtl: KV_TTL_SEC });
  } catch (e) {
    console.error("KV put error:", String(e));
  }
}
async function resolveTv360(reqUrl) {
  const id = reqUrl.searchParams.get("id");
  if (!id) return new Response(JSON.stringify({ error: "Missing 'id' parameter" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  const path = reqUrl.pathname;
  const ext = path.endsWith(".mpd") ? "mpd" : "m3u8";
  const upstreamUrl = `${API_BASE}/tv360.${ext}?id=${encodeURIComponent(id)}`;
  try {
    const sig = await makeCoSignature();
    const r = await fetch(upstreamUrl, { headers: { "User-Agent": "Cò TiVi/1.1.7", "co-signature": sig }, redirect: "manual" });
    if (r.status === 302) {
      const location = r.headers.get("location");
      if (location) return Response.redirect(location, 302);
      if (ext === "m3u8") {
        const mpdUrl = `${API_BASE}/tv360.mpd?id=${encodeURIComponent(id)}`;
        const r2 = await fetch(mpdUrl, { headers: { "User-Agent": "Cò TiVi/1.1.7", "co-signature": sig }, redirect: "manual" });
        if (r2.status === 302) {
          const loc2 = r2.headers.get("location");
          if (loc2) return Response.redirect(loc2, 302);
        }
      }
    }
    if (r.ok) {
      const text = await r.text();
      return new Response(text, { status: 200, headers: { ...CORS, "Content-Type": ext === "mpd" ? "application/dash+xml" : "application/vnd.apple.mpegurl" } });
    }
    return new Response(JSON.stringify({ error: `Upstream error: ${r.status}` }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
}
async function resolveStream(reqUrl) {
  const fetchApi = reqUrl.searchParams.get("url");
  if (!fetchApi) return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  let parsedUrl;
  try { parsedUrl = new URL(fetchApi); } catch {
    return new Response(JSON.stringify({ error: "Invalid URL" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  if (parsedUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return new Response(JSON.stringify({ error: `Domain not allowed: ${parsedUrl.hostname}` }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  if (parsedUrl.hostname === "api.cotivi.site") {
    if (parsedUrl.pathname.includes("tv360.m3u8") || parsedUrl.pathname.includes("tv360.mpd")) {
      const id = parsedUrl.searchParams.get("id") || "";
      const ext = parsedUrl.pathname.endsWith(".mpd") ? "mpd" : "m3u8";
      const sig = await makeCoSignature();
      try {
        const r = await fetch(fetchApi, { headers: { "User-Agent": "Cò TiVi/1.1.7", "co-signature": sig }, redirect: "manual" });
        if (r.status === 302) {
          const location = r.headers.get("location");
          if (location) return Response.redirect(location, 302);
          if (ext === "m3u8") {
            const mpdUrl = `${API_BASE}/tv360.mpd?id=${encodeURIComponent(id)}`;
            const r2 = await fetch(mpdUrl, { headers: { "User-Agent": "Cò TiVi/1.1.7", "co-signature": sig }, redirect: "manual" });
            if (r2.status === 302) {
              const loc2 = r2.headers.get("location");
              if (loc2) return Response.redirect(loc2, 302);
            }
          }
        }
        return new Response(JSON.stringify({ error: `Upstream error: ${r.status}` }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ error: `Path not allowed: ${parsedUrl.pathname}` }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  if (parsedUrl.hostname === "rd.locket.top") {
    try {
      const sig = await makeCoSignature();
      const r = await fetch(fetchApi, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "co-signature": sig } });
      const text = await r.text();
      if (!r.ok || !text.includes("#EXTM3U")) return new Response(JSON.stringify({ error: `Upstream error: ${r.status}` }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
      let streamUrl = "";
      for (const line of text.split("\n")) {
        const tr = line.trim();
        if (tr.startsWith("https://")) { streamUrl = tr; break; }
      }
      if (!streamUrl) return new Response(JSON.stringify({ error: "No stream URL" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
      return Response.redirect(streamUrl, 302);
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }
  }
  try {
    const r = await fetch(fetchApi, { headers: { "User-Agent": "Cò TiVi/1.1.7" } });
    let data;
    try { data = await r.json(); } catch {
      const raw = await r.text().catch(() => "");
      return new Response(JSON.stringify({ error: "Non-JSON", status: r.status, preview: raw.slice(0, 120) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!data?.status) return new Response(JSON.stringify({ error: data?.message || "Stream not available" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
    const defaultUrl = data?.default?.url || "";
    const backups = [];
    if (Array.isArray(data?.streamLink)) {
      for (const s of data.streamLink) if (s?.url && s.url !== defaultUrl) backups.push(s.url);
    }
    if (!defaultUrl && backups.length === 0) return new Response(JSON.stringify({ error: "No stream URL" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
    return Response.redirect(defaultUrl || backups[0], 302);
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
}
var M3U_HEADERS = { ...CORS, "Content-Type": "application/x-mpegurl; charset=utf-8", "Cache-Control": "public, max-age=60" };
async function serveM3U(reqUrl, path, cache, env, ctx) {
  const force = reqUrl.searchParams.get("force") === "1";
  let playlistId = "all";
  if (path.endsWith("/channels")) playlistId = "channels";
  else if (path.endsWith("/sports")) playlistId = "sports";
  const cacheKey = new Request(`https://cache.local/m3u/${playlistId}`, reqUrl);
  if (!force) {
    const cached = await getCache(cache, cacheKey);
    if (cached) return new Response(cached, { status: 200, headers: { ...M3U_HEADERS, "X-Cache": "HIT-CACHEAPI" } });
    const kvContent = await getKV(env, `m3u:${playlistId}`);
    if (kvContent) {
      ctx.waitUntil(setCache(cache, cacheKey, kvContent));
      return new Response(kvContent, { status: 200, headers: { ...M3U_HEADERS, "X-Cache": "HIT-KV" } });
    }
  }
  try {
    const { m3uContent, count } = await buildM3U(reqUrl.origin, playlistId);
    ctx.waitUntil(Promise.all([setCache(cache, cacheKey, m3uContent), setKV(env, `m3u:${playlistId}`, m3uContent)]));
    return new Response(m3uContent, { status: 200, headers: { ...M3U_HEADERS, "X-Cache": "MISS", "X-Channel-Count": String(count) } });
  } catch (e) {
    const kvFallback = await getKV(env, `m3u:${playlistId}`);
    if (kvFallback) return new Response(kvFallback, { status: 200, headers: { ...M3U_HEADERS, "X-Cache": "STALE-KV" } });
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
  }
}
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: CORS });
    const reqUrl = new URL(request.url);
    const path = reqUrl.pathname;
    const cache = caches.default;
    if (path.startsWith("/tv360/")) return resolveTv360(reqUrl);
    const hasUrlParam = !!reqUrl.searchParams.get("url");
    if (hasUrlParam) return resolveStream(reqUrl);
    const isM3uPath = path === "/" || path === "/m3u" || path === "/m3u/" || path.endsWith("/m3u/channels") || path.endsWith("/m3u/sports");
    if (isM3uPath) return serveM3U(reqUrl, path, cache, env, ctx);
    if (path === "/status") {
      try {
        const r = await fetch(`${API_BASE}/api/Channels?version=${VERSION}`, { headers: { "User-Agent": "Cò TiVi/1.1.7" } });
        const kvOk = !!env.M3U_CACHE;
        return new Response(JSON.stringify({ ok: r.ok, upstream_status: r.status, kv_bound: kvOk, version: "1.1.4" }, null, 2), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }, null, 2), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
      }
    }
    if (path === "/kv-status") {
      if (!env.M3U_CACHE) return new Response(JSON.stringify({ kv_bound: false }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
      try {
        const keys = ["m3u:all", "m3u:channels", "m3u:sports"];
        const results = {};
        for (const k of keys) {
          const raw = await env.M3U_CACHE.get(k, { type: "json" });
          results[k] = raw ? { ts: raw.ts, age_sec: Math.floor((Date.now() - raw.ts) / 1e3), size: raw.content?.length || 0 } : null;
        }
        return new Response(JSON.stringify({ kv_bound: true, keys: results }, null, 2), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...CORS, "Content-Type": "application/json" } });
      }
    }
    return new Response("Not found. Use / for M3U playlist, /?url=... for stream resolve, /tv360/m3u8?id=... or /tv360/mpd?id=... for TV360, /status for health, /kv-status for KV info.", { status: 404, headers: CORS });
  },
  async scheduled(event, env, ctx) {
    const playlists = ["all", "channels", "sports"];
    const origin = "https://dekiiptv95.bacbenny95.workers.dev";
    for (const pid of playlists) {
      ctx.waitUntil(
        buildM3U(origin, pid)
          .then(({ m3uContent }) => setKV(env, `m3u:${pid}`, m3uContent))
          .catch((e) => console.error(`Cron build failed for ${pid}:`, String(e)))
      );
    }
  }
};
