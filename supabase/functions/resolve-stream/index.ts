import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @deno-types="npm:@types/aes-js"
import aesJs from "npm:aes-js@3.1.2";

// ── Whitelist ─────────────────────────────────────────────────────────────────
const ALLOWED_HOSTS = new Set(["pay.locket.top", "rd.locket.top"]);

// ── AES-256-ECB co-signature ──────────────────────────────────────────────────
const SIG_KEY = new TextEncoder().encode("vuongdeptraivuongdeptraivklvkl12");

function pkcs7Pad(data: Uint8Array): Uint8Array {
  const padLen = 16 - (data.length % 16);
  const padded = new Uint8Array(data.length + padLen);
  padded.set(data);
  padded.fill(padLen, data.length);
  return padded;
}

async function makeCoSignature(ipData: unknown): Promise<string> {
  const ts = String(Date.now());
  const payload = JSON.stringify({ ipData, firtTime: ts, lastTime: ts });
  const bytes = pkcs7Pad(new TextEncoder().encode(payload));
  const ecb = new aesJs.ModeOfOperation.ecb(SIG_KEY);
  const encrypted: Uint8Array = ecb.encrypt(bytes);
  return btoa(String.fromCharCode(...encrypted));
}

async function getIpData(): Promise<unknown> {
  try {
    const r = await fetch("https://ipinfo.io/json", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    return await r.json();
  } catch {
    return {};
  }
}

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ═══════════════════════════════════════════════════════════════════════════════
// M3U AUTO-UPDATE LOGIC (merged from cotivi-m3u)
// ═══════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const API_BASE = "https://api.cotivi.site";
const VERSION = "1.1.2";
const CACHE_TTL_MS = 5 * 60 * 1000;

const CHANNELS_KEY = new TextEncoder().encode("6677150266771502cotivichatvkl321");
const SPORTS_KEY = new TextEncoder().encode("6677150266771502cotivichatvkl999");

const REALTIME_GROUPS = new Set(["Giờ Vàng", "Tiếu Lâm"]);

const GROUP_CONFIG: [string, string[]][] = [
  ["Giờ Vàng", ["Giờ Vàng"]],
  ["Tiếu Lâm", ["Tiếu Lâm"]],
  ["VTV", ["VTV"]],
  ["Thiết Yếu", ["Thiết Yếu"]],
  ["VTVCab", ["VTVCab Thể Thao", "VTVCab"]],
  ["SCTV", ["SCTV Thể Thao", "SCTV"]],
  ["HTV", ["HTV"]],
  ["In The Box", ["In The Box"]],
  ["Nước Ngoài", ["Nước Ngoài"]],
  ["Địa phương", ["Địa phương", "THVL"]],
  ["Thử nghiệm", ["Thử nghiệm"]],
  ["SCTV Test", ["SCTV Test"]],
  ["Sự Kiện VTVPrime", ["Sự Kiện VTVPrime"]],
  ["Sự Kiện TV360", ["Sự Kiện TV360"]],
];

const EXCLUDE_GROUPS = new Set(["World Cup", "WorldCup Nước Ngoài"]);

function pkcs7Unpad(data: Uint8Array): Uint8Array {
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > 16) return data;
  return data.subarray(0, data.length - padLen);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64urlHex(s: string): string {
  if (!s) return "";
  const pad = "=".repeat(-s.length % 4);
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  let hex = "";
  for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
}

function decryptAesEcb(b64Data: string, key: Uint8Array): unknown {
  const raw = base64ToBytes(b64Data);
  const ecb = new aesJs.ModeOfOperation.ecb(key);
  const decrypted = ecb.decrypt(raw);
  const unpadded = pkcs7Unpad(decrypted);
  const text = new TextDecoder().decode(unpadded);
  return JSON.parse(text);
}

async function fetchEndpoint(path: string, key: Uint8Array): Promise<unknown> {
  const url = `${API_BASE}${path}?version=${VERSION}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Cò TiVi/1.1.7" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  const json = await res.json() as { key: string; data: string };
  return decryptAesEcb(json.data, key);
}

interface Channel {
  id?: string; name?: string; icon?: string; link?: string;
  header?: Record<string, string>; onDrm?: boolean;
  drmOptions?: { type?: string; licenseServer?: string };
  clearkey?: { keys?: Array<{ kid?: string; k?: string }> };
}

interface Sport {
  id?: string; home?: string; away?: string; name?: string;
  homeLogo?: string; awayLogo?: string; icon?: string; blv?: string;
  onlyDay?: string; onlyTime?: string; live?: boolean; fetchApi?: string;
  header?: Record<string, string>;
}

interface ApiData { Data?: Array<{ Kenh?: string; List?: Channel[] | Sport[] }> }

async function buildClearkeyProps(ch: Channel): Promise<string[]> {
  const drm = ch.drmOptions || {};
  if (drm.type !== "clearkey") return [];
  const pairs: [string, string][] = [];
  const ck = ch.clearkey;
  if (ck?.keys) {
    for (const k of ck.keys) {
      const kid = b64urlHex(k.kid || "");
      const key = b64urlHex(k.k || "");
      if (kid && key) pairs.push([kid, key]);
    }
  }
  if (pairs.length === 0 && drm.licenseServer) {
    try {
      const r = await fetch(drm.licenseServer, {
        headers: { "User-Agent": "Cò TiVi/1.1.7", "Referer": "https://giovang.link" },
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const data = await r.json() as { keys?: Array<{ kid?: string; k?: string }> };
        for (const k of data.keys || []) {
          const kid = b64urlHex(k.kid || "");
          const key = b64urlHex(k.k || "");
          if (kid && key) pairs.push([kid, key]);
        }
      }
    } catch { /* ignore */ }
  }
  if (pairs.length === 0) return [];
  const licenseKey = pairs.map(([kid, key]) => `${kid}:${key}`).join("|");
  return [
    "#KODIPROP:inputstream.adaptive.license_type=clearkey",
    `#KODIPROP:inputstream.adaptive.license_key=${licenseKey}`,
  ];
}

async function buildChannelsM3U(data: ApiData): Promise<{ m3u: string; count: number }> {
  const lines = ["#EXTM3U"];
  let count = 0;
  for (const group of data.Data || []) {
    const grp = group.Kenh || "Unknown";
    for (const chRaw of group.List || []) {
      const ch = chRaw as Channel;
      const link = ch.link || "";
      if (!link || !link.startsWith("http")) continue;
      const name = ch.name || ch.id || "Unknown";
      const icon = ch.icon || "";
      const hdr = ch.header || {};
      const ua = hdr["User-agent"] || hdr["user-agent"] || "";
      lines.push(`#EXTINF:-1 tvg-id="${ch.id || ""}" tvg-name="${name}" tvg-logo="${icon}" group-title="${grp}",${name}`);
      if (ua) lines.push(`#EXTVLCOPT:http-user-agent=${ua}`);
      const props = await buildClearkeyProps(ch);
      for (const prop of props) lines.push(prop);
      lines.push(link);
      count++;
    }
  }
  return { m3u: lines.join("\n") + "\n", count };
}

function buildSportsM3U(data: ApiData): { m3u: string; count: number } {
  const allItems: [string, Sport][] = [];
  for (const group of data.Data || []) {
    const grp = group.Kenh || "Unknown";
    for (const chRaw of group.List || []) allItems.push([grp, chRaw as Sport]);
  }
  const lines = ["#EXTM3U"];
  let count = 0;
  for (const [grp, ch] of allItems) {
    const home = ch.home || "";
    const away = ch.away || "";
    const sportName = (ch.name || "").trim();
    const icon = ch.homeLogo || ch.awayLogo || ch.icon || "";
    const blv = (ch.blv || "").trim();
    const day = (ch.onlyDay || "").trim();
    const t = (ch.onlyTime || "").trim();
    const timeStr = t && day ? `${t}-${day}` : `${day} ${t}`.trim();
    const fetchApiUrl = ch.fetchApi || "";
    let streamUrl = "";
    if (REALTIME_GROUPS.has(grp) && fetchApiUrl) {
      const selfUrl = `${SUPABASE_URL}/functions/v1/resolve-stream`;
      streamUrl = `${selfUrl}?url=${encodeURIComponent(fetchApiUrl)}`;
    } else {
      streamUrl = fetchApiUrl;
    }
    if (!streamUrl) continue;
    let matchName = home && away ? `${home} - ${away}` : sportName;
    let title = matchName;
    if (blv) {
      const blvClean = blv.replace("BLV ", "").replace("BLV", "").trim();
      title += ` [BLV ${blvClean}]`;
    }
    const league = sportName.replace(/^[\p{Emoji}\s]+/u, "").trim();
    if (league && league !== matchName) title += ` - ${league}`;
    if (timeStr) title = `[${timeStr}] ${title}`;
    lines.push(`#EXTINF:-1 tvg-id="${ch.id || ""}" tvg-name="${title}" tvg-logo="${icon}" group-title="${grp}",${title}`);
    lines.push(streamUrl);
    count++;
  }
  return { m3u: lines.join("\n") + "\n", count };
}

function reorderGroups(lines: string[]): string[] {
  if (!lines.length) return lines;
  const buckets: Record<string, string[]> = {};
  let currentGroup: string | null = null;
  for (const line of lines) {
    if (line.startsWith("#EXTINF")) {
      const m = line.match(/group-title="([^"]*)"/);
      currentGroup = m ? m[1] : "Unknown";
    }
    (buckets[currentGroup || "Unknown"] ||= []).push(line);
  }
  const relabel = (line: string, newGroup: string): string =>
    line.startsWith("#EXTINF") ? line.replace(/group-title="[^"]*"/, `group-title="${newGroup}"`) : line;
  const ordered: string[] = [];
  for (const [targetLabel, sources] of GROUP_CONFIG) {
    for (const src of sources) {
      for (const line of buckets[src] || []) ordered.push(relabel(line, targetLabel));
      delete buckets[src];
    }
  }
  for (const remaining of Object.values(buckets)) ordered.push(...remaining);
  return ordered;
}

async function getCached(id: string): Promise<{ content: string; channel_count: number; updated_at: string } | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/m3u_cache?id=eq.${encodeURIComponent(id)}&select=content,channel_count,updated_at`, {
    headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return null;
  const rows = await r.json() as Array<{ content: string; channel_count: number; updated_at: string }>;
  return rows.length > 0 ? rows[0] : null;
}

async function setCached(id: string, content: string, count: number): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/m3u_cache`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ id, content, channel_count: count, updated_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(5000),
  });
}

async function handleM3URequest(reqUrl: URL): Promise<Response> {
  const path = reqUrl.pathname;
  const force = reqUrl.searchParams.get("force") === "1";
  let playlistId = "all";
  if (path.endsWith("/channels")) playlistId = "channels";
  else if (path.endsWith("/sports")) playlistId = "sports";

  try {
    if (!force) {
      const cached = await getCached(playlistId);
      if (cached) {
        const age = Date.now() - new Date(cached.updated_at).getTime();
        if (age < CACHE_TTL_MS) {
          return new Response(cached.content, {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/x-mpegurl; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=60", "X-Cache": "HIT", "X-Cache-Age-Seconds": Math.floor(age / 1000).toString() },
          });
        }
      }
    }

    const [channelsData, sportsData] = await Promise.all([
      fetchEndpoint("/api/Channels", CHANNELS_KEY).catch((e) => { console.error("Channels fetch failed:", String(e)); return null; }),
      fetchEndpoint("/api/Sports", SPORTS_KEY).catch((e) => { console.error("Sports fetch failed:", String(e)); return null; }),
    ]);

    if (!channelsData && !sportsData) {
      const stale = await getCached(playlistId);
      if (stale) return new Response(stale.content, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/x-mpegurl; charset=utf-8", "X-Cache": "STALE" } });
      return new Response(JSON.stringify({ error: "Both endpoints failed" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let m3uContent = "";
    let count = 0;

    if (playlistId === "channels" && channelsData) {
      const result = await buildChannelsM3U(channelsData as ApiData);
      m3uContent = result.m3u; count = result.count;
    } else if (playlistId === "sports" && sportsData) {
      const result = buildSportsM3U(sportsData as ApiData);
      m3uContent = result.m3u; count = result.count;
    } else {
      const allLines: string[] = ["#EXTM3U"];
      if (channelsData) {
        const result = await buildChannelsM3U(channelsData as ApiData);
        for (const line of result.m3u.split("\n").slice(1)) if (line.trim()) allLines.push(line);
      }
      if (sportsData) {
        const result = buildSportsM3U(sportsData as ApiData);
        for (const line of result.m3u.split("\n").slice(1)) if (line.trim()) allLines.push(line);
      }
      const filtered: string[] = [];
      let skipBlock = false;
      for (const line of allLines) {
        if (line.startsWith("#EXTINF")) {
          const m = line.match(/group-title="([^"]*)"/);
          skipBlock = m ? EXCLUDE_GROUPS.has(m[1]) : false;
        }
        if (!skipBlock) filtered.push(line);
      }
      const reordered = reorderGroups(filtered);
      m3uContent = reordered.join("\n") + "\n";
      count = reordered.filter((l) => l.startsWith("#EXTINF")).length;
    }

    if (count === 0) {
      const stale = await getCached(playlistId);
      if (stale) return new Response(stale.content, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/x-mpegurl; charset=utf-8", "X-Cache": "STALE" } });
      return new Response(JSON.stringify({ error: "No entries generated" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await setCached(playlistId, m3uContent, count);
    return new Response(m3uContent, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/x-mpegurl; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=60", "X-Cache": "MISS" } });
  } catch (e) {
    console.error("m3u error:", String(e));
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const reqUrl = new URL(req.url);
  const path = reqUrl.pathname;

  // ── Route: /m3u, /m3u/channels, /m3u/sports → auto-updated M3U playlist ──────
  if (path === "/m3u" || path === "/m3u/" || path.endsWith("/m3u/channels") || path.endsWith("/m3u/sports") || (path.endsWith("/m3u") && !reqUrl.searchParams.get("url"))) {
    return handleM3URequest(reqUrl);
  }

  const fetchApi = reqUrl.searchParams.get("url");
  const proxyMode = reqUrl.searchParams.get("proxy") === "1";

  if (!fetchApi) {
    if (path === "/status") {
      try {
        const testUrl = "https://pay.locket.top/tv/get.php?source=tieulamtv&keys=test";
        const r = await fetch(testUrl, {
          headers: { "User-Agent": "Cò TiVi/1.1.7" },
          signal: AbortSignal.timeout(8000),
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

    const html = `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>resolve-stream</title>
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
<h1>resolve-stream <span class="badge">ONLINE</span></h1>
<p>Edge Function – resolve stream URLs + auto-update M3U playlists.</p>

<div class="row"><b>Stream resolve:</b><br>
<code>GET /?url=&lt;encoded_fetchApi_url&gt;</code><br>
<code>GET /?url=&lt;encoded_fetchApi_url&gt;&amp;proxy=1</code>
</div>

<div class="row"><b>M3U playlists (auto-updated, 5-min cache):</b><br>
<a href="/m3u">/m3u</a> — all channels + sports<br>
<a href="/m3u/channels">/m3u/channels</a> — channels only<br>
<a href="/m3u/sports">/m3u/sports</a> — sports only<br>
<code>GET /m3u?force=1</code> — bypass cache
</div>

<div class="row"><b>Status:</b><br>
<a href="/status">/status</a>
</div>

<div class="row err">URL này dùng cho IPTV player qua file M3U, không mở trực tiếp trên trình duyệt.</div>
</body></html>`;
    return new Response(html, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(fetchApi);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (parsedUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return new Response(
      JSON.stringify({ error: `Domain not allowed: ${parsedUrl.hostname}` }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Branch A: rd.locket.top ─────────────────────────────────────────────────
  if (parsedUrl.hostname === "rd.locket.top") {
    try {
      const ipData = await getIpData();
      const sig = await makeCoSignature(ipData);
      const r = await fetch(fetchApi, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          "co-signature": sig,
        },
        signal: AbortSignal.timeout(12000),
      });
      const text = await r.text();
      if (!r.ok || text.includes("error signature") || text.includes("error sign") || !text.includes("#EXTM3U")) {
        return new Response(JSON.stringify({ error: `Upstream error: ${r.status}`, detail: text.slice(0, 120) }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      let streamUrl = "";
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("https://")) { streamUrl = trimmed; break; }
      }
      if (!streamUrl) {
        return new Response(JSON.stringify({ error: "No stream URL in playlist" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 302, headers: { ...corsHeaders, Location: streamUrl, "Cache-Control": "public, max-age=30, s-maxage=30" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  // ── Branch B: pay.locket.top ────────────────────────────────────────────────
  try {
    const r = await fetch(fetchApi, {
      headers: { "User-Agent": "Cò TiVi/1.1.7" },
      signal: AbortSignal.timeout(10000),
    });
    let data;
    try {
      data = await r.json();
    } catch {
      const rawBody = await r.text().catch(() => "");
      return new Response(JSON.stringify({ error: "Upstream returned non-JSON", status: r.status, preview: rawBody.slice(0, 120) }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!data?.status) {
      return new Response(JSON.stringify({ error: data?.message || "Stream not available" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const defaultUrl = data?.default?.url || "";
    const backups: string[] = [];
    if (Array.isArray(data?.streamLink)) {
      for (const s of data.streamLink) {
        if (s?.url && s.url !== defaultUrl) backups.push(s.url);
      }
    }
    if (!defaultUrl && backups.length === 0) {
      return new Response(JSON.stringify({ error: "No stream URL found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (proxyMode && backups.length > 0) {
      for (const cand of backups) {
        try {
          const sr = await fetch(cand, { headers: { "User-Agent": "Cò TiVi/1.1.7" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
          if (!sr.ok) continue;
          const text = await sr.text();
          if (!text.includes("#EXTM3U")) continue;
          const baseUrl = new URL(cand);
          const rewritten = text.split("\n").map((line: string) => {
            const t = line.trim();
            if (!t || t.startsWith("#")) return line;
            try { return new URL(t, baseUrl).href; } catch { return line; }
          }).join("\n");
          return new Response(rewritten, { status: 200, headers: { ...corsHeaders, "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8", "Cache-Control": "public, max-age=30, s-maxage=30" } });
        } catch { /* try next */ }
      }
    }
    const streamUrl = defaultUrl || backups[0];
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: streamUrl, "Cache-Control": "public, max-age=60, s-maxage=60" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
