import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Whitelist: chỉ cho phép resolve từ các domain đã biết của Cò TiVi.
// Ngăn chặn SSRF — edge function không thể bị dùng làm proxy tuỳ ý.
const ALLOWED_HOSTS = new Set(["pay.locket.top"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

  // Validate URL — chỉ cho phép HTTPS và domain nằm trong whitelist
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

    // 302 redirect đến CDN stream URL.
    // Cache 60 giây: giảm số lần gọi pay.locket.top khi nhiều player cùng xem,
    // nhưng đủ ngắn để link mới được nhận khi match vừa bắt đầu.
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: streamUrl,
        "Cache-Control": "public, max-age=60, s-maxage=60",
      },
    });
  } catch (e) {
    console.error("resolve-stream error:", String(e), "url:", fetchApi);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
