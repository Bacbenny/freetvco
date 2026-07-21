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

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const reqUrl = new URL(req.url);
  const fetchApi = reqUrl.searchParams.get("url");
  const proxyMode = reqUrl.searchParams.get("proxy") === "1";

  if (!fetchApi) {
    const path = reqUrl.pathname;
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
<p>Cloudflare Worker / Edge Function – giải mã link Tiểu Lâm / Giờ Vàng từ <code>pay.locket.top</code> và <code>rd.locket.top</code>.</p>

<div class="row"><b>Cách dùng:</b><br>
<code>GET /?url=&lt;encoded_fetchApi_url&gt;</code><br>
<code>GET /?url=&lt;encoded_fetchApi_url&gt;&amp;proxy=1</code> &nbsp;← cho player ngoài VN
</div>

<div class="row"><b>Kiểm tra trạng thái:</b><br>
<a href="/status">/status</a>
</div>

<div class="row err">⚠️ Lỗi này (<code>Missing 'url' parameter</code>) xảy ra khi mở URL gốc worker trực tiếp trên trình duyệt. <b>Đây là bình thường</b> – URL này chỉ dùng cho IPTV player qua file M3U, không mở trực tiếp.</div>
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
        console.error("resolve-stream rd.locket: bad response", r.status, text.slice(0, 120), "url:", fetchApi);
        return new Response(
          JSON.stringify({ error: `Upstream error: ${r.status}`, detail: text.slice(0, 120) }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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

    const asynccdnUrl = data?.default?.url || "";
    const backups: string[] = [];
    if (Array.isArray(data?.streamLink)) {
      for (const s of data.streamLink) {
        if (s?.url && s.url !== asynccdnUrl) backups.push(s.url);
      }
    }

    if (!asynccdnUrl && backups.length === 0) {
      return new Response(JSON.stringify({ error: "No stream URL found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Proxy mode: thử từng backup URL, rewrite relative URLs thành absolute
    if (proxyMode && backups.length > 0) {
      for (const cand of backups) {
        try {
          const sr = await fetch(cand, {
            headers: { "User-Agent": "Cò TiVi/1.1.7" },
            signal: AbortSignal.timeout(8000),
            redirect: "follow",
          });
          if (!sr.ok) continue;
          const text = await sr.text();
          if (!text.includes("#EXTM3U")) continue;
          const baseUrl = new URL(cand);
          const rewritten = text.split("\n").map((line: string) => {
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
              "Cache-Control": "public, max-age=30, s-maxage=30",
            },
          });
        } catch {
          // try next backup
        }
      }
    }

    const streamUrl = asynccdnUrl || backups[0];
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
