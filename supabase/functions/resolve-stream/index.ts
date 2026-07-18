import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @deno-types="npm:@types/aes-js"
import aesjs from "npm:aes-js@3.1.2";

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
  const ecb = new aesjs.ModeOfOperation.ecb(SIG_KEY);
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

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const reqUrl = new URL(req.url);
  const fetchApi = reqUrl.searchParams.get("url");

  if (!fetchApi) {
    return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(fetchApi);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid URL" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (parsedUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return new Response(
      JSON.stringify({ error: `Domain not allowed: ${parsedUrl.hostname}` }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Branch A: rd.locket.top ─────────────────────────────────────────────────
  // co-signature → 302 → CDN master M3U → 307 → final M3U → parse HTTPS URL → 302
  if (parsedUrl.hostname === "rd.locket.top") {
    try {
      const ipData = await getIpData();
      const sig = await makeCoSignature(ipData);

      // fetch() tự follow redirect (302 → 307 → 200 master M3U)
      const r = await fetch(fetchApi, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          "co-signature": sig,
        },
        signal: AbortSignal.timeout(12000),
      });

      const text = await r.text();

      if (!r.ok || text.includes("error signature") || text.includes("error sign") || !text.includes("#EXTM3U")) {
        console.error("resolve-stream rd.locket: bad response", r.status, text.slice(0, 120), "url:", fetchApi);
        return new Response(
          JSON.stringify({ error: `Upstream error: ${r.status}`, detail: text.slice(0, 120) }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Parse master M3U: lấy URL HTTPS đầu tiên (variant 480p)
      let streamUrl = "";
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("https://")) {
          streamUrl = trimmed;
          break;
        }
      }

      if (!streamUrl) {
        console.error("resolve-stream rd.locket: no HTTPS URL in M3U", fetchApi, text.slice(0, 300));
        return new Response(JSON.stringify({ error: "No stream URL in playlist" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // bpk-token ngắn hạn → cache 30s
      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          Location: streamUrl,
          "Cache-Control": "public, max-age=30, s-maxage=30",
        },
      });
    } catch (e) {
      console.error("resolve-stream rd.locket error:", String(e), "url:", fetchApi);
      return new Response(JSON.stringify({ error: String(e) }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ── Branch B: pay.locket.top ────────────────────────────────────────────────
  // JSON {status, default.url} → 302
  try {
    const r = await fetch(fetchApi, {
      headers: { "User-Agent": "Cò TiVi/1.1.7" },
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json();

    if (!data?.status) {
      return new Response(
        JSON.stringify({ error: data?.message || "Stream not available" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const streamUrl = data?.default?.url || data?.streamLink?.[0]?.url;
    if (!streamUrl) {
      return new Response(JSON.stringify({ error: "No stream URL found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: streamUrl,
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    });
  } catch (e) {
    console.error("resolve-stream pay.locket error:", String(e), "url:", fetchApi);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
