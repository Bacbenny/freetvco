// hoofoot-proxy: HLS manifest + segment proxy for hoofoot.ru IPTV streams.
// Caching via Supabase DB table `stream_cache`: stream URLs (4 min) + manifests (20 s).
// Auto-fallback: if the requested server fails, try other servers before giving up.
// Segment proxy: rewrites media URLs in manifests to route through this proxy,
//   adding the Referer header that hoofoot.ru requires (players can't send it).

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

const STREAM_TTL_SEC = 240;   // 4 minutes
const MANIFEST_TTL_SEC = 20;  // 20 seconds

// Accept both "cdn" (used in playlist) and "cdn-live" (API endpoint)
const SERVER_ALIAS: Record<string, string> = {
  "cdn": "cdn-live",
  "cdn-live": "cdn-live",
  "stream": "stream",
  "tms": "tms",
  "tvn": "tvn",
};

const ALLOWED_SERVERS = new Set(Object.keys(SERVER_ALIAS));

// Fallback order: try requested server first, then others
const FALLBACK_SERVERS = ["stream", "cdn-live", "tms", "tvn"];

// --- DB cache helpers ---

async function cacheGet(key: string): Promise<string | null> {
  const url = `${SUPABASE_URL}/rest/v1/stream_cache?select=cache_value&cache_key=eq.${encodeURIComponent(key)}&expires_at=gt.now()`;
  const resp = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (Array.isArray(data) && data.length > 0) return data[0].cache_value;
  return null;
}

async function cacheSet(key: string, value: string, ttlSec: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/stream_cache`;
  const body = JSON.stringify({
    cache_key: key,
    cache_value: value,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body,
  });
}

async function cacheDelete(key: string): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/stream_cache?cache_key=eq.${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
}

// --- hoofoot.ru helpers ---

async function getAuthToken(channelId: string): Promise<string> {
  const resp = await fetch(`${HOOFOOT_BASE}/api/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      Referer: HOOFOOT_BASE,
    },
    body: JSON.stringify({ channelId }),
  });
  if (!resp.ok) throw new Error(`auth token HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.token) throw new Error("no token in auth response");
  return data.token as string;
}

async function getStreamUrl(
  channelId: string,
  server: string,
): Promise<string> {
  const apiServer = SERVER_ALIAS[server] ?? server;
  const cacheKey = `stream:${channelId}:${apiServer}`;

  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const token = await getAuthToken(channelId);
  const endpoint = apiServer === "tms" ? "/api/tms/" : `/api/${apiServer}/`;
  const url = `${HOOFOOT_BASE}${endpoint}${encodeURIComponent(channelId)}`;

  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      "Auth-Token": token,
      Referer: HOOFOOT_BASE,
    },
  });

  let streamUrl: string | null = null;

  if (resp.status === 401) {
    const newToken = await getAuthToken(channelId);
    const retry = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": UA,
        "Auth-Token": newToken,
        Referer: HOOFOOT_BASE,
      },
    });
    if (!retry.ok) throw new Error(`stream HTTP ${retry.status}`);
    const data = await retry.json();
    streamUrl = data.streamUrl ?? null;
  } else {
    if (!resp.ok) throw new Error(`stream HTTP ${resp.status}`);
    const data = await resp.json();
    streamUrl = data.streamUrl ?? null;
  }

  if (!streamUrl) throw new Error("no streamUrl in response");

  const fullUrl = new URL(streamUrl, HOOFOOT_BASE).toString();
  await cacheSet(cacheKey, fullUrl, STREAM_TTL_SEC);
  return fullUrl;
}

// Rewrite media URLs in manifest to route through this proxy.
// This ensures the player's requests include the Referer header hoofoot.ru requires.
function rewriteManifest(manifest: string, baseUrl: string, proxyBase: string): string {
  const manifestUrl = new URL(baseUrl);
  return manifest
    .split("\n")
    .map((line) => {
      const value = line.trim();
      if (!value || value.startsWith("#")) return line;
      try {
        const absolute = new URL(value, manifestUrl).toString();
        // Route through our proxy's /segment endpoint
        return `${proxyBase}/segment?url=${encodeURIComponent(absolute)}`;
      } catch {
        return line;
      }
    })
    .join("\n");
}

// Try to fetch a working manifest from a single server.
async function tryServer(
  channelId: string,
  server: string,
  proxyBase: string,
): Promise<{ manifest: string; server: string } | null> {
  const apiServer = SERVER_ALIAS[server] ?? server;

  try {
    const streamUrl = await getStreamUrl(channelId, apiServer);

    const manifestKey = `manifest:${streamUrl}`;
    const mCached = await cacheGet(manifestKey);
    if (mCached) {
      return { manifest: mCached, server: apiServer };
    }

    let manifestResponse = await fetch(streamUrl, {
      headers: { "User-Agent": UA, Referer: HOOFOOT_BASE },
    });

    if (
      !manifestResponse.ok &&
      (manifestResponse.status === 404 || manifestResponse.status === 500)
    ) {
      await cacheDelete(`stream:${channelId}:${apiServer}`);
      const freshUrl = await getStreamUrl(channelId, apiServer);
      manifestResponse = await fetch(freshUrl, {
        headers: { "User-Agent": UA, Referer: HOOFOOT_BASE },
      });
      if (!manifestResponse.ok) return null;

      const body = await manifestResponse.text();
      const rewritten = rewriteManifest(body, freshUrl, proxyBase);
      await cacheSet(`manifest:${freshUrl}`, rewritten, MANIFEST_TTL_SEC);
      return { manifest: rewritten, server: apiServer };
    }

    if (!manifestResponse.ok) return null;

    const body = await manifestResponse.text();
    const rewritten = rewriteManifest(body, streamUrl, proxyBase);
    await cacheSet(manifestKey, rewritten, MANIFEST_TTL_SEC);
    return { manifest: rewritten, server: apiServer };
  } catch {
    return null;
  }
}

// Proxy a single media segment/playlist from hoofoot.ru with proper headers.
async function proxySegment(req: Request, proxyBase: string): Promise<Response> {
  const url = new URL(req.url);
  const targetUrl = url.searchParams.get("url");
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: "missing url param" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Only allow proxying hoofoot.ru URLs
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

  const resp = await fetch(targetUrl, {
    headers: { "User-Agent": UA, Referer: HOOFOOT_BASE },
  });

  // Inspect a clone so binary media data remains untouched in the original response.
  const body = await resp.clone().text();

  // If this is a sub-manifest (contains #EXTM3U), rewrite its URLs too
  if (body.includes("#EXTM3U")) {
    const rewritten = rewriteManifest(body, targetUrl, proxyBase);
    return new Response(rewritten, {
      status: resp.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  }

  // Pass through binary segment data
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "video/mp2t");
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(resp.body, {
    status: resp.status,
    headers,
  });
}

// --- Main handler ---

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);

  // Build the public proxy base URL from SUPABASE_URL (the internal req.url 
  // uses http and a stripped path, which won't work for players)
  const proxyBase = `${SUPABASE_URL}/functions/v1/hoofoot-proxy`;

  // Segment proxy endpoint: .../segment?url=...
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

  for (const srv of ordered) {
    const result = await tryServer(channelId, srv, proxyBase);
    if (result) {
      const isFallback = srv !== apiServer;
      return new Response(result.manifest, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Cache": isFallback ? `MISS-FALLBACK-${srv}` : "MISS",
        },
      });
    }
  }

  return new Response(JSON.stringify({ error: `all servers failed for ${channelId}` }), {
    status: 502,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
