import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import aesJs from "npm:aes-js@3.1.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = "https://api.cotivi.site";
const VERSION = "1.1.2";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const CHANNELS_KEY = new TextEncoder().encode("6677150266771502cotivichatvkl321");
const SPORTS_KEY = new TextEncoder().encode("6677150266771502cotivichatvkl999");

const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/resolve-stream`;

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ── AES-256-ECB decrypt ───────────────────────────────────────────────────────
function pkcs7Unpad(data: Uint8Array): Uint8Array {
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > 16) return data;
  return data.subarray(0, data.length - padLen);
}

function decryptAesEcb(b64Data: string, key: Uint8Array): unknown {
  const raw = base64ToBytes(b64Data);
  const ecb = new aesJs.ModeOfOperation.ecb(key);
  const decrypted = ecb.decrypt(raw);
  const unpadded = pkcs7Unpad(decrypted);
  const text = new TextDecoder().decode(unpadded);
  return JSON.parse(text);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64urlHex(s: string): string {
  if (!s) return "";
  const pad = "=".repeat(-s.length % 4);
  const binary = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  let hex = "";
  for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, "0");
  return hex;
}

// ── Fetch + decrypt from cotivi API ───────────────────────────────────────────
async function fetchEndpoint(path: string, key: Uint8Array): Promise<unknown> {
  const url = `${API_BASE}${path}?version=${VERSION}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Cò TiVi/1.1.7" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  const json = await res.json() as { key: string; data: string };
  const keyField = new TextDecoder().decode(base64ToBytes(json.key));
  return decryptAesEcb(json.data, key);
}

// ── M3U builders ──────────────────────────────────────────────────────────────
interface Channel {
  id?: string;
  name?: string;
  icon?: string;
  link?: string;
  header?: Record<string, string>;
  onDrm?: boolean;
  drmOptions?: { type?: string; licenseServer?: string };
  clearkey?: { keys?: Array<{ kid?: string; k?: string }> };
}

interface Sport {
  id?: string;
  home?: string;
  away?: string;
  name?: string;
  homeLogo?: string;
  awayLogo?: string;
  icon?: string;
  blv?: string;
  onlyDay?: string;
  onlyTime?: string;
  live?: boolean;
  fetchApi?: string;
  header?: Record<string, string>;
}

interface ApiData {
  Data?: Array<{ Kenh?: string; List?: Channel[] | Sport[] }>;
}

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

      lines.push(
        `#EXTINF:-1 tvg-id="${ch.id || ""}" tvg-name="${name}" tvg-logo="${icon}" group-title="${grp}",${name}`
      );
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
    for (const chRaw of group.List || []) {
      allItems.push([grp, chRaw as Sport]);
    }
  }

  const lines = ["#EXTM3U"];
  let count = 0;

  for (const [grp, ch] of allItems) {
    const home = ch.home || "";
    const away = ch.away || "";
    const sportName = (ch.name || "").trim();
    const display = home && away ? `${home} vs ${away}` : sportName;
    const icon = ch.homeLogo || ch.awayLogo || ch.icon || "";
    const blv = (ch.blv || "").trim();
    const day = (ch.onlyDay || "").trim();
    const t = (ch.onlyTime || "").trim();
    const timeStr = t && day ? `${t}-${day}` : `${day} ${t}`.trim();

    const fetchApiUrl = ch.fetchApi || "";
    let streamUrl = "";
    const extvlcLines: string[] = [];

    if (REALTIME_GROUPS.has(grp) && fetchApiUrl && EDGE_FUNCTION_URL) {
      const encoded = encodeURIComponent(fetchApiUrl);
      streamUrl = `${EDGE_FUNCTION_URL}?url=${encoded}`;
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

    lines.push(
      `#EXTINF:-1 tvg-id="${ch.id || ""}" tvg-name="${title}" tvg-logo="${icon}" group-title="${grp}",${title}`
    );
    extvlcLines.forEach((l) => lines.push(l));
    lines.push(streamUrl);
    count++;
  }

  return { m3u: lines.join("\n") + "\n", count };
}

// ── Group reorder (matches fetch.py GROUP_CONFIG) ────────────────────────────
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
    line.startsWith("#EXTINF")
      ? line.replace(/group-title="[^"]*"/, `group-title="${newGroup}"`)
      : line;

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

// ── Cache helpers (raw PostgREST — no supabase-js dependency) ──────────────────
async function getCached(id: string): Promise<{ content: string; channel_count: number; updated_at: string } | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/m3u_cache?id=eq.${encodeURIComponent(id)}&select=content,channel_count,updated_at`, {
    headers: {
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
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
      "apikey": SUPABASE_SERVICE_KEY,
      "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({ id, content, channel_count: count, updated_at: new Date().toISOString() }),
    signal: AbortSignal.timeout(5000),
  });
}

// ── Main handler ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;
  const force = url.searchParams.get("force") === "1";

  // Route: /cotivi-m3u → all, /cotivi-m3u/channels → channels, /cotivi-m3u/sports → sports
  let playlistId = "all";
  if (path.endsWith("/channels")) playlistId = "channels";
  else if (path.endsWith("/sports")) playlistId = "sports";

  try {
    // Check cache (unless force refresh)
    if (!force) {
      const cached = await getCached(playlistId);
      if (cached) {
        const age = Date.now() - new Date(cached.updated_at).getTime();
        if (age < CACHE_TTL_MS) {
          return new Response(cached.content, {
            status: 200,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/x-mpegurl; charset=utf-8",
              "Cache-Control": "public, max-age=60, s-maxage=60",
              "X-Cache": "HIT",
              "X-Cache-Age-Seconds": Math.floor(age / 1000).toString(),
            },
          });
        }
      }
    }

    // Fetch + decrypt both endpoints
    const [channelsData, sportsData] = await Promise.all([
      fetchEndpoint("/api/Channels", CHANNELS_KEY).catch((e) => {
        console.error("Channels fetch failed:", String(e));
        return null;
      }),
      fetchEndpoint("/api/Sports", SPORTS_KEY).catch((e) => {
        console.error("Sports fetch failed:", String(e));
        return null;
      }),
    ]);

    if (!channelsData && !sportsData) {
      // Return stale cache if available
      const stale = await getCached(playlistId);
      if (stale) {
        return new Response(stale.content, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/x-mpegurl; charset=utf-8",
            "Cache-Control": "public, max-age=30, s-maxage=30",
            "X-Cache": "STALE",
          },
        });
      }
      return new Response(JSON.stringify({ error: "Both endpoints failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build requested playlist
    let m3uContent = "";
    let count = 0;

    if (playlistId === "channels" && channelsData) {
      const result = await buildChannelsM3U(channelsData as ApiData);
      m3uContent = result.m3u;
      count = result.count;
    } else if (playlistId === "sports" && sportsData) {
      const result = buildSportsM3U(sportsData as ApiData);
      m3uContent = result.m3u;
      count = result.count;
    } else {
      // Build combined "all" playlist
      const allLines: string[] = ["#EXTM3U"];
      if (channelsData) {
        const result = await buildChannelsM3U(channelsData as ApiData);
        for (const line of result.m3u.split("\n").slice(1)) {
          if (line.trim()) allLines.push(line);
        }
      }
      if (sportsData) {
        const result = buildSportsM3U(sportsData as ApiData);
        for (const line of result.m3u.split("\n").slice(1)) {
          if (line.trim()) allLines.push(line);
        }
      }

      // Remove excluded groups
      const filtered: string[] = [];
      let skipBlock = false;
      for (const line of allLines) {
        if (line.startsWith("#EXTINF")) {
          const m = line.match(/group-title="([^"]*)"/);
          skipBlock = m ? EXCLUDE_GROUPS.has(m[1]) : false;
        }
        if (!skipBlock) filtered.push(line);
      }

      // Reorder groups
      const reordered = reorderGroups(filtered);
      m3uContent = reordered.join("\n") + "\n";
      count = reordered.filter((l) => l.startsWith("#EXTINF")).length;
    }

    if (count === 0) {
      const stale = await getCached(playlistId);
      if (stale) {
        return new Response(stale.content, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/x-mpegurl; charset=utf-8",
            "Cache-Control": "public, max-age=30, s-maxage=30",
            "X-Cache": "STALE",
          },
        });
      }
      return new Response(JSON.stringify({ error: "No entries generated" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save to cache
    await setCached(playlistId, m3uContent, count);

    return new Response(m3uContent, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/x-mpegurl; charset=utf-8",
        "Cache-Control": "public, max-age=60, s-maxage=60",
        "X-Cache": "MISS",
      },
    });
  } catch (e) {
    console.error("cotivi-m3u error:", String(e));
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
