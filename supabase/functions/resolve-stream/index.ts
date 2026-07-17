import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const fetchApi = url.searchParams.get("url");

  if (!fetchApi) {
    return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

    // 302 redirect to the CDN stream URL
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: streamUrl },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
