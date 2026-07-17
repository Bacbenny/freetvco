import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @deno-types="npm:@types/aes-js"
import aesjs from "npm:aes-js@3.1.2";

// ── Whitelist ─────────────────────────────────────────────────────────────────
// Chỉ cho phép resolve từ các domain đã biết. Ngăn SSRF.
const ALLOWED_HOSTS = new Set(["pay.locket.top", "rd.locket.top"]);

// ── AES-256-ECB co-signature (reverse-engineered từ Cò TiVi APK) ─────────────
// Key đã public trong source code APK (Hermes bytecode). Dùng để call rd.locket.top.
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

  // Validate: HTTPS + domain whitelist
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
  // Cần co-signature. Trả về master M3U playlist → parse lấy CDN URL đầu tiên.
  if (parsedUrl.hostname === "rd.locket.top") {
    try {
      const ipData = await getIpData();
      const sig = await makeCoSignature(ipData);

      const r = await fetch(fetchApi, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
          "co-signature": sig,
        },
        signal: AbortSignal.timeout(10000),
      });

      const text = await r.text();

      if (text.includes("error signature") || text.includes("error sign")) {
        console.error("resolve-stream rd.locket: signature rejected", fetchApi);
        return new Response(JSON.stringify({ error: "Signature rejected by server" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Parse master M3U: lấy URL đầu tiên (480p — bandwidth thấp nhất, ổn định nhất)
      let streamUrl = "";
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("https://")) {
          streamUrl = trimmed;
          break;
        }
      }

      if (!streamUrl) {
        console.error("resolve-stream rd.locket: no URL in response", fetchApi, text.slice(0, 200));
        return new Response(JSON.stringify({ error: "No stream URL found in playlist" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // bpk-token tồn tại vài phút → cache ngắn 30s
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
  // Trả về JSON {status, default.url} → parse → 302 redirect.
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
