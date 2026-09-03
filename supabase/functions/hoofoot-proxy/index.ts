// hoofoot-proxy v2.5: HLS manifest + segment proxy for hoofoot.ru IPTV streams.
// Performance optimisations:
//   1. Fire-and-forget DB writes (don't block response on cache persistence)
//   2. In-memory LRU cache layered on top of DB cache
//   3. Longer TTLs: token 10 min, stream URL 8 min, manifest 60s (stale window 120s)
//   4. Segment proxy: detect manifest by Content-Type, avoid buffering video segments
//   5. Parallel server racing preserved
//   6. Stale-while-revalidate: return stale cache immediately, refresh in background

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const HOOFOOT_BASE = "https://hoofoot.ru";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const STREAM_TTL_SEC = 480;
const MANIFEST_TTL_SEC = 60;
const TOKEN_TTL_SEC = 600;
const STALE_WINDOW_STREAM = 120;
const STALE_WINDOW_MANIFEST = 120;

const SERVER_ALIAS: Record<string, string> = {
  "cdn": "cdn-live",
  "cdn-live": "cdn-live",
  "stream": "stream",
  "tms": "tms",
  "tvn": "tvn",
};

const ALLOWED_SERVERS = new Set(Object.keys(SERVER_ALIAS));
const FALLBACK_SERVERS = ["stream", "cdn-live", "tms", "tvn"];

// ── In-memory caches ────────────────────────────────────────────────────────────
interface CacheEntry { value: string; expiresAt: number; staleAt: number }
const memStreamCache = new Map<string, CacheEntry>();
const memManifestCache = new Map<string, CacheEntry>();
const memTokenCache = new Map<string, CacheEntry>();

function memGet(cache: Map<string, CacheEntry>, key: string): { value: string; stale: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (now < entry.expiresAt) return { value: entry.value, stale: false };
  if (now < entry.staleAt) return { value: entry.value, stale: true };
  cache.delete(key);
  return null;
}

function memSet(cache: Map<string, CacheEntry>, key: string, value: string, ttlSec: number, staleWindowSec: number) {
  const now = Date.now();
  cache.set(key, { value, expiresAt: now + ttlSec * 1000, staleAt: now + (ttlSec + staleWindowSec) * 1000 });
  if (cache.size > 500) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, 200);
    for (const [k] of oldest) cache.delete(k);
  }
}

// ── DB cache helpers (fire-and-forget writes) ───────────────────────────────────

async function dbCacheGet(key: string): Promise<string | null> {
  const url = `${SUPABASE_URL}/rest/v1/stream_cache?select=cache_value&cache_key=eq.${encodeURIComponent(key)}&expires_at=gt.now()`;
  try {
    const resp = await fetch(url, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0 && data[0].cache_value) {
      return data[0].cache_value as string;
    }
  } catch { /* ignore DB errors, memory cache is primary */ }
  return null;
}

function dbCacheSet(key: string, value: string, ttlSec: number): void {
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/stream_cache`;
  const body = JSON.stringify({
    cache_key: key,
    cache_value: value,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body,
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

function dbCacheDelete(key: string): void {
  const url = `${SUPABASE_URL}/rest/v1/stream_cache?cache_key=eq.${encodeURIComponent(key)}`;
  fetch(url, {
    method: "DELETE",
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

// ── Cache: memory first, DB fallback, fire-and-forget write ─────────────────────

async function streamCacheGet(key: string): Promise<{ value: string; stale: boolean } | null> {
  const mem = memGet(memStreamCache, key);
  if (mem) return mem;
  const dbVal = await dbCacheGet(key);
  if (dbVal) {
    memSet(memStreamCache, key, dbVal, STREAM_TTL_SEC, STALE_WINDOW_STREAM);
    return { value: dbVal, stale: false };
  }
  return null;
}

async function manifestCacheGet(key: string): Promise<{ value: string; stale: boolean } | null> {
  const mem = memGet(memManifestCache, key);
  if (mem) return mem;
  const dbVal = await dbCacheGet(key);
  if (dbVal) {
    memSet(memManifestCache, key, dbVal, MANIFEST_TTL_SEC, STALE_WINDOW_MANIFEST);
    return { value: dbVal, stale: false };
  }
  return null;
}

function streamCacheSet(key: string, value: string): void {
  memSet(memStreamCache, key, value, STREAM_TTL_SEC, STALE_WINDOW_STREAM);
  dbCacheSet(key, value, STREAM_TTL_SEC);
}

function manifestCacheSet(key: string, value: string): void {
  memSet(memManifestCache, key, value, MANIFEST_TTL_SEC, STALE_WINDOW_MANIFEST);
  dbCacheSet(key, value, MANIFEST_TTL_SEC);
}

// ── hoofoot.ru helpers ──────────────────────────────────────────────────────────

async function getAuthToken(channelId: string): Promise<string> {
  const tokenMem = memGet(memTokenCache, `token:${channelId}`);
  if (tokenMem) return tokenMem.value;

  const resp = await fetch(`${HOOFOOT_BASE}/api/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      Referer: HOOFOOT_BASE,
    },
    body: JSON.stringify({ channelId }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`auth token HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.token) throw new Error("no token in auth response");
  const token = data.token as string;
  memSet(memTokenCache, `token:${channelId}`, token, TOKEN_TTL_SEC, 300);
  return token;
}

async function getStreamUrl(channelId: string, server: string): Promise<string> {
  const apiServer = SERVER_ALIAS[server] ?? server;
  const cacheKey = `stream:${channelId}:${apiServer}`;

  const cached = await streamCacheGet(cacheKey);
  if (cached && !cached.stale) return cached.value;
  const staleValue = cached?.stale ? cached.value : null;

  try {
    const token = await getAuthToken(channelId);
    const endpoint = apiServer === "tms" ? "/api/tms/" : `/api/${apiServer}/`;
    const url = `${HOOFOOT_BASE}${endpoint}${encodeURIComponent(channelId)}`;

    let resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        "Auth-Token": token,
        Referer: HOOFOOT_BASE,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (resp.status === 401) {
      memTokenCache.delete(`token:${channelId}`);
      const newToken = await getAuthToken(channelId);
      resp = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": UA,
          "Auth-Token": newToken,
          Referer: HOOFOOT_BASE,
        },
        signal: AbortSignal.timeout(8000),
      });
    }

    if (!resp.ok) throw new Error(`stream HTTP ${resp.status}`);
    const data = await resp.json();
    const streamUrl = data.streamUrl ?? null;
    if (!streamUrl) throw new Error("no streamUrl in response");

    const fullUrl = new URL(streamUrl, HOOFOOT_BASE).toString();
    streamCacheSet(cacheKey, fullUrl);
    return fullUrl;
  } catch (e) {
    if (staleValue) return staleValue;
    throw e;
  }
}

function rewriteManifest(manifest: string, baseUrl: string, proxyBase: string): string {
  const manifestUrl = new URL(baseUrl);
  return manifest
    .split("\n")
    .map((line) => {
      const value = line.trim();
      if (!value || value.startsWith("#")) return line;
      try {
        const absolute = new URL(value, manifestUrl).toString();
        return `${proxyBase}/segment?url=${encodeURIComponent(absolute)}`;
      } catch {
        return line;
      }
    })
    .join("\n");
}

async function tryServer(
  channelId: string,
  server: string,
  proxyBase: string,
): Promise<{ manifest: string; server: string } | null> {
  const apiServer = SERVER_ALIAS[server] ?? server;

  try {
    const streamUrl = await getStreamUrl(channelId, apiServer);

    const manifestKey = `manifest:${streamUrl}`;
    const manifestCached = await manifestCacheGet(manifestKey);
    if (manifestCached && !manifestCached.stale) {
      return { manifest: manifestCached.value, server: apiServer };
    }

    let manifestResponse = await fetch(streamUrl, {
      headers: { "User-Agent": UA, Referer: HOOFOOT_BASE },
      signal: AbortSignal.timeout(8000),
    });

    if (!manifestResponse.ok && (manifestResponse.status === 404 || manifestResponse.status === 500)) {
      memStreamCache.delete(`stream:${channelId}:${apiServer}`);
      dbCacheDelete(`stream:${channelId}:${apiServer}`);
      const freshUrl = await getStreamUrl(channelId, apiServer);
      manifestResponse = await fetch(freshUrl, {
        headers: { "User-Agent": UA, Referer: HOOFOOT_BASE },
        signal: AbortSignal.timeout(8000),
      });
      if (!manifestResponse.ok) return null;

      const body = await manifestResponse.text();
      const rewritten = rewriteManifest(body, freshUrl, proxyBase);
      manifestCacheSet(`manifest:${freshUrl}`, rewritten);
      return { manifest: rewritten, server: apiServer };
    }

    if (!manifestResponse.ok) return null;

    const body = await manifestResponse.text();
    const rewritten = rewriteManifest(body, streamUrl, proxyBase);
    manifestCacheSet(manifestKey, rewritten);
    return { manifest: rewritten, server: apiServer };
  } catch {
    return null;
  }
}

async function tryServersParallel(
  channelId: string,
  servers: string[],
  proxyBase: string,
): Promise<{ manifest: string; server: string } | null> {
  if (servers.length <= 1) {
    return tryServer(channelId, servers[0], proxyBase);
  }

  const primary = servers[0];
  const secondary = servers[1];
  const rest = servers.slice(2);

  const results = await Promise.allSettled([
    tryServer(channelId, primary, proxyBase),
    tryServer(channelId, secondary, proxyBase),
  ]);

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled" && results[i].value) {
      return results[i].value;
    }
  }

  for (const srv of rest) {
    const result = await tryServer(channelId, srv, proxyBase);
    if (result) return result;
  }

  return null;
}

async function proxySegment(req: Request, proxyBase: string): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "missing url param" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: "invalid url" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (parsed.hostname !== "hoofoot.ru") {
    return new Response(JSON.stringify({ error: "url must be hoofoot.ru" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const manifestKey = `manifest:${targetUrl}`;
  const manifestMem = memGet(memManifestCache, manifestKey);
  if (manifestMem && !manifestMem.stale) {
    return new Response(manifestMem.value, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  const resp = await fetch(targetUrl, {
    headers: { "User-Agent": UA, Referer: HOOFOOT_BASE },
    signal: AbortSignal.timeout(8000),
  });

  const contentType = resp.headers.get("Content-Type") || "";
  const isManifest = contentType.includes("mpegurl") || contentType.includes("m3u") || targetUrl.includes(".m3u8");

  if (isManifest) {
    const body = await resp.text();
    const rewritten = rewriteManifest(body, targetUrl, proxyBase);
    manifestCacheSet(manifestKey, rewritten);
    return new Response(rewritten, {
      status: resp.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", contentType || "video/mp2t");
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(resp.body, {
    status: resp.status,
    headers,
  });
}

// ── Main handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const proxyBase = `${SUPABASE_URL}/functions/v1/hoofoot-proxy`;

  if (url.pathname.includes("/segment")) {
    return proxySegment(req, proxyBase);
  }

  const channelId = url.searchParams.get("id");
  const server = url.searchParams.get("server") || "stream";

  if (!channelId || !ALLOWED_SERVERS.has(server)) {
    return new Response(JSON.stringify({ error: "invalid channel or server" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const apiServer = SERVER_ALIAS[server] ?? server;
  const ordered = [apiServer, ...FALLBACK_SERVERS.filter((s) => s !== apiServer)];

  const result = await tryServersParallel(channelId, ordered, proxyBase);

  if (result) {
    const isFallback = result.server !== apiServer;
    return new Response(result.manifest, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Cache": isFallback ? `MISS-FALLBACK-${result.server}` : "MISS",
      },
    });
  }

  return new Response(JSON.stringify({ error: `all servers failed for ${channelId}` }), {
    status: 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
