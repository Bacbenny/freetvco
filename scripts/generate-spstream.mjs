
#!/usr/bin/env node

const fs = require("node:fs");
const API = "https://sport-stream-resolver-v2.viet-ng228.workers.dev";
const CATALOG = API + "/sport.json";
const OUTPUT = "spstream.m3u";
const CONCURRENCY = 12;
const TIMEOUT_MS = 20000;

function clean(value) {
  return String(value || "").replace(/[\\r\\n]/g, " ").replace(/"/g, "'").trim();
}

function streamUrl(url, headers) {
  const pairs = Object.entries(headers || {})
    .filter(function(entry) { return String(entry[1] || "").trim(); })
    .map(function(entry) { return encodeURIComponent(entry[0]) + "=" + encodeURIComponent(String(entry[1])); });
  return pairs.length ? url + "|" + pairs.join("&") : url;
}

async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(function() { controller.abort(); }, TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache", "User-Agent": "freetvco-spstream-action/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function resolveMatch(match) {
  try {
    return { match: match, payload: await getJson(match.resolver) };
  } catch (error) {
    console.warn("Skip " + match.id + ": " + error.message);
    return { match: match, payload: null };
  }
}

async function mapConcurrent(items, workerCount, worker) {
  const result = [];
  let next = 0;
  async function workerLoop() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(workerCount, items.length) }, workerLoop));
  return result;
}

const catalog = await getJson(CATALOG);
const providers = Object.fromEntries((catalog.providers || []).map(function(item) { return [item.id, item.name || item.id]; }));
const sports = Object.fromEntries((catalog.sports || []).map(function(item) { return [item.id, item.name || item.id]; }));
const matches = (catalog.matches || [])
  .filter(function(match) { return match && match.resolver; })
  .sort(function(a, b) { return Number(Boolean(b.live || b.is_live)) - Number(Boolean(a.live || a.is_live)) || (a.kickoff || 0) - (b.kickoff || 0); });

const resolved = await mapConcurrent(matches, CONCURRENCY, resolveMatch);
const lines = ["#EXTM3U"];
let sourceCount = 0;
for (const item of resolved) {
  const match = item.match;
  const payload = item.payload;
  if (!payload || !payload.ok) continue;
  const matchName = match.name || match.title || match.id || "SPORT STREAM";
  const provider = providers[match.provider] || match.provider_name || match.provider || "SPORT";
  const group = sports[match.sport] || "SPORT STREAM";
  const logo = match.home_logo || match.logo || "";
  for (let index = 0; index < (payload.sources || []).length; index += 1) {
    const source = payload.sources[index];
    const url = String(source.url || "").trim();
    if (!url) continue;
    const title = clean(matchName + " • " + (source.name || provider + " #" + (index + 1)));
    const attributes = [
      "tvg-id=\"" + clean(match.id) + "\"",
      "tvg-name=\"" + clean(matchName) + "\"",
      "group-title=\"" + clean(group) + "\"",
    ];
    if (logo) attributes.push("tvg-logo=\"" + clean(logo) + "\"");
    lines.push("#EXTINF:-1 " + attributes.join(" ") + "," + title);
    const headers = source.headers || {};
    if (headers.Referer) lines.push("#EXTVLCOPT:http-referrer=" + headers.Referer);
    if (headers.Origin) lines.push("#EXTVLCOPT:http-origin=" + headers.Origin);
    if (headers["User-Agent"]) lines.push("#EXTVLCOPT:http-user-agent=" + headers["User-Agent"]);
    lines.push(streamUrl(url, headers));
    sourceCount += 1;
  }
}

if (!sourceCount) throw new Error("No playable sources were returned; keeping the previous playlist");
fs.writeFileSync(OUTPUT, lines.join("\\n") + "\\n", "utf8");
console.log("Wrote " + sourceCount + " streams from " + matches.length + " catalog matches to " + OUTPUT);
