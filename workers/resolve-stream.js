var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// resolve-stream.js
var ALLOWED_HOSTS = /* @__PURE__ */ new Set(["pay.locket.top", "rd.locket.top"]);
var SIG_KEY = new TextEncoder().encode("vuongdeptraivuongdeptraivklvkl12");
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
var SBOX = (() => {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let p = 1, q = 1;
  for (let i = 0; i < 255; i++) {
    p = (p ^ p << 1 ^ (p & 128 ? 27 : 0)) & 255;
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q = (q ^ (q & 128 ? 9 : 0)) & 255;
    const x = (q ^ q << 1 ^ (q & 128 ? 27 : 0)) & 255;
    const t = s[x];
    s[x] = s[p];
    s[p] = t;
  }
  const sbox = new Uint8Array(256);
  const inv = new Uint8Array(256);
  for (let i = 0; i < 256; i++) inv[s[i]] = i;
  for (let i = 0; i < 256; i++) {
    let x = inv[i];
    let y = x;
    y ^= x << 1 | x >> 7;
    y ^= x << 2 | x >> 6;
    y ^= x << 3 | x >> 5;
    y ^= x << 4 | x >> 4;
    y ^= 99;
    sbox[i] = y & 255;
  }
  return sbox;
})();
var RCON = new Uint8Array([0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54, 108, 216, 171, 77, 154]);
function keyExpansion(key) {
  const Nk = 8, Nr = 14;
  const w = new Uint8Array(4 * 4 * (Nr + 1));
  w.set(key);
  let i = Nk;
  while (i < 4 * (Nr + 1)) {
    let t = [w[(i - 1) * 4], w[(i - 1) * 4 + 1], w[(i - 1) * 4 + 2], w[(i - 1) * 4 + 3]];
    if (i % Nk === 0) {
      t = [t[1], t[2], t[3], t[0]].map((b) => SBOX[b]);
      t[0] ^= RCON[i / Nk];
    } else if (Nk > 6 && i % Nk === 4) {
      t = t.map((b) => SBOX[b]);
    }
    for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - Nk) * 4 + j] ^ t[j];
    i++;
  }
  return w;
}
__name(keyExpansion, "keyExpansion");
function xtime(x) {
  return (x << 1 ^ (x & 128 ? 27 : 0)) & 255;
}
__name(xtime, "xtime");
function mul(a, b) {
  let r = 0, x = a, y = b;
  for (let i = 0; i < 8; i++) {
    if (y & 1) r ^= x;
    x = xtime(x);
    y >>= 1;
  }
  return r & 255;
}
__name(mul, "mul");
function encryptBlock(input, w) {
  const Nr = 14;
  let s = new Uint8Array(16);
  s.set(input);
  for (let j = 0; j < 16; j++) s[j] ^= w[j];
  for (let round = 1; round < Nr; round++) {
    for (let j = 0; j < 16; j++) s[j] = SBOX[s[j]];
    let t2 = s.slice();
    s[1] = t2[5];
    s[5] = t2[9];
    s[9] = t2[13];
    s[13] = t2[1];
    s[2] = t2[10];
    s[6] = t2[14];
    s[10] = t2[2];
    s[14] = t2[6];
    s[3] = t2[15];
    s[7] = t2[3];
    s[11] = t2[7];
    s[15] = t2[11];
    for (let c = 0; c < 4; c++) {
      const [a0, a1, a2, a3] = [s[c * 4], s[c * 4 + 1], s[c * 4 + 2], s[c * 4 + 3]];
      s[c * 4] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3;
      s[c * 4 + 1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3;
      s[c * 4 + 2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3);
      s[c * 4 + 3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2);
    }
    for (let j = 0; j < 16; j++) s[j] ^= w[round * 16 + j];
  }
  for (let j = 0; j < 16; j++) s[j] = SBOX[s[j]];
  let t = s.slice();
  s[1] = t[5];
  s[5] = t[9];
  s[9] = t[13];
  s[13] = t[1];
  s[2] = t[10];
  s[6] = t[14];
  s[10] = t[2];
  s[14] = t[6];
  s[3] = t[15];
  s[7] = t[3];
  s[11] = t[7];
  s[15] = t[11];
  for (let j = 0; j < 16; j++) s[j] ^= w[Nr * 16 + j];
  return s;
}
__name(encryptBlock, "encryptBlock");
function pkcs7Pad(data) {
  const padLen = 16 - data.length % 16;
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded.fill(padLen, data.length);
  return padded;
}
__name(pkcs7Pad, "pkcs7Pad");
function aesEcbEncrypt(key, data) {
  const w = keyExpansion(key);
  const padded = pkcs7Pad(data);
  const out = new Uint8Array(padded.length);
  for (let i = 0; i < padded.length; i += 16)
    out.set(encryptBlock(padded.subarray(i, i + 16), w), i);
  return out;
}
__name(aesEcbEncrypt, "aesEcbEncrypt");
function bytesToBase64(bytes) {
  let b = "";
  for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
}
__name(bytesToBase64, "bytesToBase64");

// FIX 1: firtTime -> firstTime (typo sửa)
// FIX 2: nhận req để lấy IP thực của client thay vì IP edge Cloudflare
async function makeCoSignature(ipData) {
  const ts = String(Date.now());
  const payload = JSON.stringify({ ipData, firstTime: ts, lastTime: ts });
  return bytesToBase64(aesEcbEncrypt(SIG_KEY, new TextEncoder().encode(payload)));
}
__name(makeCoSignature, "makeCoSignature");

// FIX 2: getIpData nhận req, lấy CF-Connecting-IP thực của client
// không gọi ipinfo.io từ edge server (sẽ trả về IP datacenter Cloudflare)
function getIpData(req) {
  const ip = req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "";
  const cf = req.cf || {};
  return {
    ip,
    country: cf.country || "",
    city: cf.city || "",
    region: cf.region || "",
    org: "",
    timezone: cf.timezone || "",
    loc: cf.latitude && cf.longitude ? `${cf.latitude},${cf.longitude}` : ""
  };
}
__name(getIpData, "getIpData");

// FIX 3: extractStreamUrl - bỏ qua các dòng # (metadata, EXT-X-KEY, v.v.)
function extractStreamUrl(text) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("https://") || t.startsWith("http://")) return t;
  }
  return "";
}
__name(extractStreamUrl, "extractStreamUrl");

var resolve_stream_default = {
  // FIX 7: thêm env, ctx theo đúng chuẩn Cloudflare Worker
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 200, headers: corsHeaders });
    const reqUrl = new URL(req.url);
    const fetchApi = reqUrl.searchParams.get("url");
    const proxyMode = reqUrl.searchParams.get("proxy") === "1";
    if (!fetchApi) {
      const path = reqUrl.pathname;
      if (path === "/status") {
        try {
          const testUrl = "https://pay.locket.top/tv/get.php?source=tieulamtv&keys=test";
          const r = await fetch(testUrl, {
            headers: { "User-Agent": "C\xF2 Ti Vi/1.1.7" },
            signal: AbortSignal.timeout(8e3)
          });
          const body = await r.text();
          return new Response(
            JSON.stringify({ ok: true, upstream_status: r.status, upstream_sample: body.slice(0, 80) }, null, 2),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (e) {
          return new Response(
            JSON.stringify({ ok: false, error: String(e) }, null, 2),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      // Endpoint /m3u — serve playlist M3U với Supabase URL đã được thay thế bằng Cloudflare worker URL
      // Hỗ trợ: /m3u hoặc /m3u/all → toàn bộ 215 kênh
      //         /m3u/sports → 55 kênh thể thao (Giờ Vàng + Tiểu Lâm)
      //         /m3u/channels → 160 kênh tivi (VTVPrime, v.v.)
      if (path === "/m3u" || path === "/m3u/all" || path === "/m3u/sports" || path === "/m3u/channels") {
        const GH_RAW = "https://raw.githubusercontent.com/Bacbenny/freetvco/main/output/";
        const fileMap = {
          "/m3u": "cotivi_all.m3u",
          "/m3u/all": "cotivi_all.m3u",
          "/m3u/sports": "cotivi_sports.m3u",
          "/m3u/channels": "cotivi_channels.m3u",
        };
        const fileName = fileMap[path];
        try {
          const ghRes = await fetch(GH_RAW + fileName, {
            headers: { "User-Agent": "Cloudflare-Worker/1.0" },
            signal: AbortSignal.timeout(10e3)
          });
          if (!ghRes.ok) {
            return new Response(
              JSON.stringify({ error: `GitHub fetch failed: ${ghRes.status}` }),
              { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          let m3uText = await ghRes.text();
          // Thêm #EXTM3U header nếu thiếu
          if (!m3uText.startsWith("#EXTM3U")) {
            m3uText = "#EXTM3U\n" + m3uText;
          }
          // Replace Supabase resolver URL → Cloudflare worker URL
          const SUPABASE_BASE = "https://isokhcqqlbdwkfkttvki.supabase.co/functions/v1/resolve-stream";
          const CF_BASE = reqUrl.origin;
          m3uText = m3uText.replaceAll(SUPABASE_BASE, CF_BASE);
          return new Response(m3uText, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/x-mpegurl; charset=utf-8",
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Content-Disposition": `inline; filename="${fileName}"`
            }
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: `M3U fetch error: ${String(e)}` }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      // FIX 6: dùng URL động từ request thay vì hardcode domain
      const workerHost = reqUrl.origin;
      const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>dekiiptv95 \u2013 resolve-stream</title>
<style>
  body{font-family:monospace;background:#111;color:#eee;margin:0;padding:24px;line-height:1.6}
  h1{color:#4af;margin-bottom:4px}
  .badge{display:inline-block;background:#1a3;color:#fff;border-radius:4px;padding:2px 8px;font-size:.8em}
  code{background:#222;padding:2px 6px;border-radius:3px;word-break:break-all}
  .row{margin:10px 0}
  a{color:#4af}
  .err{color:#f66}
  .ok{color:#4af}
</style></head><body>
<h1>dekiiptv95 <span class="badge">ONLINE</span></h1>
<p>Cloudflare Worker \u2013 gi\u1EA3i m\xE3 link Ti\u1EBFu L\xE2m / Gi\u1EDD V\xE0ng t\u1EEB <code>pay.locket.top</code> v\xE0 <code>rd.locket.top</code>.</p>

<div class="row"><b>C\xE1ch d\xF9ng:</b><br>
<code>GET /?url=&lt;encoded_fetchApi_url&gt;</code><br>
<code>GET /?url=&lt;encoded_fetchApi_url&gt;&amp;proxy=1</code> &nbsp;\u2190 cho player ngo\xE0i VN
</div>

<div class="row"><b>V\xED d\u1EE5 URL stream trong M3U:</b><br>
<code>${workerHost}?url=https%3A%2F%2Fpay.locket.top%2Ftv%2Fget.php%3Fsource%3Dtieulamtv%26keys%3D8yomo4h138l4q0j</code>
</div>

<div class="row"><b>Ki\u1EC3m tra tr\u1EA1ng th\xE1i:</b><br>
<a href="/status">/status</a>
</div>

<div class="row err">\u26A0\uFE0F L\u1ED7i n\xE0y (<code>Missing 'url' parameter</code>) x\u1EA3y ra khi m\u1EDF URL g\u1ED1c worker tr\u1EF1c ti\u1EBFp tr\xEAn tr\xECnh duy\u1EC7t. <b>\u0110\xE2y l\xE0 b\xECnh th\u01B0\u1EDDng</b> \u2013 URL n\xE0y ch\u1EC9 d\xF9ng cho IPTV player qua file M3U, kh\xF4ng m\u1EDF tr\u1EF1c ti\u1EBFp.</div>
</body></html>`;
      return new Response(html, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" }
      });
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(fetchApi);
    } catch {
      return new Response(JSON.stringify({ error: "Invalid URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    if (parsedUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
      return new Response(
        JSON.stringify({ error: `Domain not allowed: ${parsedUrl.hostname}` }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (parsedUrl.hostname === "rd.locket.top") {
      try {
        // FIX 2: truyền req vào getIpData để lấy IP thực của client
        const ipData = getIpData(req);
        const sig = await makeCoSignature(ipData);
        const r = await fetch(fetchApi, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "co-signature": sig
          },
          signal: AbortSignal.timeout(12e3)
        });
        const text = await r.text();
        if (!r.ok || text.includes("error signature") || !text.includes("#EXTM3U")) {
          return new Response(
            JSON.stringify({ error: `Upstream error: ${r.status}`, detail: text.slice(0, 120) }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        // FIX 3: dùng extractStreamUrl thay vì lấy dòng https:// đầu tiên bừa bãi
        const streamUrl = extractStreamUrl(text);
        if (!streamUrl)
          return new Response(JSON.stringify({ error: "No stream URL in playlist" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: streamUrl, "Cache-Control": "public, max-age=30, s-maxage=30" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }
    try {
      const r = await fetch(fetchApi, {
        headers: { "User-Agent": "C\xF2 Ti Vi/1.1.7" },
        signal: AbortSignal.timeout(1e4)
      });
      // FIX 4: kiểm tra Content-Type trước khi parse JSON
      // tránh crash khi pay.locket.top trả về HTML lỗi hoặc rate-limit
      const ct = r.headers.get("content-type") || "";
      let data;
      try {
        data = await r.json();
      } catch {
        const rawBody = await r.text().catch(() => "");
        return new Response(
          JSON.stringify({ error: "Upstream returned non-JSON", status: r.status, preview: rawBody.slice(0, 120) }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!data?.status) {
        return new Response(
          JSON.stringify({ error: data?.message || "Stream not available" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const defaultUrl = data?.default?.url || "";
      const backups = [];
      if (Array.isArray(data?.streamLink)) {
        for (const s of data.streamLink) {
          if (s?.url && s.url !== defaultUrl) backups.push(s.url);
        }
      }
      if (!defaultUrl && backups.length === 0)
        return new Response(JSON.stringify({ error: "No stream URL found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      if (proxyMode && backups.length > 0) {
        for (const cand of backups) {
          try {
            const sr = await fetch(cand, {
              headers: { "User-Agent": "C\xF2 Ti Vi/1.1.7" },
              signal: AbortSignal.timeout(8e3),
              redirect: "follow"
            });
            if (!sr.ok) continue;
            const text = await sr.text();
            if (!text.includes("#EXTM3U")) continue;
            const baseUrl = new URL(cand);
            const rewritten = text.split("\n").map((line) => {
              const t = line.trim();
              if (!t || t.startsWith("#")) return line;
              try {
                return new URL(t, baseUrl).href;
              } catch {
                return line;
              }
            }).join("\n");
            return new Response(rewritten, {
              status: 200,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
                "Cache-Control": "public, max-age=30, s-maxage=30"
              }
            });
          } catch {
          }
        }
        // FIX 5: proxyMode - tất cả backup đều fail -> báo lỗi rõ ràng thay vì redirect bừa
        return new Response(
          JSON.stringify({ error: "Proxy mode: all backup streams failed", tried: backups.length }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const streamUrl = defaultUrl || backups[0];
      return new Response(null, {
        status: 302,
        headers: { ...corsHeaders, Location: streamUrl, "Cache-Control": "public, max-age=60, s-maxage=60" }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
export {
  resolve_stream_default as default
};
