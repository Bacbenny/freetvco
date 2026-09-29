var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/types.ts
var VN_TZ_OFFSET_MS = 7 * 60 * 60 * 1e3;
var FINISHED_STATUS = /* @__PURE__ */ new Set([
  "finished",
  "end",
  "ended",
  "complete",
  "completed"
]);
var MATCH_MAX_AGE_SECONDS = 7200;
var _CDN = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72";
var SPORT_LOGOS = {
  football: `${_CDN}/26bd.png`,
  tennis: `${_CDN}/1f3be.png`,
  basketball: `${_CDN}/1f3c0.png`,
  volleyball: `${_CDN}/1f3d0.png`,
  billiards: `${_CDN}/1f3b1.png`,
  badminton: `${_CDN}/1f3f8.png`,
  boxing: `${_CDN}/1f94a.png`,
  golf: `${_CDN}/26f3.png`,
  esport: `${_CDN}/1f3ae.png`,
  motorsport: `${_CDN}/1f3ce.png`,
  athletics: `${_CDN}/1f3c3.png`,
  swimming: `${_CDN}/1f3ca.png`,
  martialarts: `${_CDN}/1f94b.png`,
  cycling: `${_CDN}/1f6b4.png`,
  hockey: `${_CDN}/1f3d2.png`,
  default: `${_CDN}/1f3c6.png`
};
function logoFromText(text) {
  const t = text.toLowerCase();
  if (t.includes("tennis")) return SPORT_LOGOS.tennis;
  if (["basketball", "b\xF3ng r\u1ED5", "bong ro", "nba", "wnba"].some((k) => t.includes(k))) return SPORT_LOGOS.basketball;
  if (["volleyball", "b\xF3ng chuy\u1EC1n", "bong chuyen"].some((k) => t.includes(k))) return SPORT_LOGOS.volleyball;
  if (["billiard", "bi-a", "bia", "snooker", "pool", "uk open"].some((k) => t.includes(k))) return SPORT_LOGOS.billiards;
  if (["badminton", "c\u1EA7u l\xF4ng", "cau long"].some((k) => t.includes(k))) return SPORT_LOGOS.badminton;
  if (["boxing", "kickbox", "muay", "quy\u1EC1n anh", "quyen anh", "ufc", "mma"].some((k) => t.includes(k))) return SPORT_LOGOS.boxing;
  if (t.includes("golf")) return SPORT_LOGOS.golf;
  if (["esport", "e-sport", "gaming", "lol", "dota", "valorant", "fifa online"].some((k) => t.includes(k))) return SPORT_LOGOS.esport;
  if (["formula", "f1 ", " f1", "motogp", "moto gp", "\u0111ua xe", "dua xe", "motorsport", "superbike", "wtcc"].some((k) => t.includes(k))) return SPORT_LOGOS.motorsport;
  if (["athletics", "\u0111i\u1EC1n kinh", "dien kinh", "marathon", "ch\u1EA1y", "cha y"].some((k) => t.includes(k))) return SPORT_LOGOS.athletics;
  if (["swim", "b\u01A1i l\u1ED9i", "boi loi", "aquatic"].some((k) => t.includes(k))) return SPORT_LOGOS.swimming;
  if (["karate", "judo", "taekwondo", "wushu", "v\xF5 thu\u1EADt", "vo thuat", "wrestling", "kung fu", "wwe", "smackdown", "raw", "aew", "impact", "muay thai", "kickboxing", "bjj"].some((k) => t.includes(k))) return SPORT_LOGOS.martialarts;
  if (["cycl", "xe \u0111\u1EA1p", "xe dap", "velo"].some((k) => t.includes(k))) return SPORT_LOGOS.cycling;
  if (["hockey", "kh\xFAc c\xF4n", "khuc con"].some((k) => t.includes(k))) return SPORT_LOGOS.hockey;
  return SPORT_LOGOS.football;
}
__name(logoFromText, "logoFromText");
function formatVnTime(dateStr) {
  try {
    const dt = new Date(dateStr);
    if (isNaN(dt.getTime())) throw new Error("invalid");
    const vn = new Date(dt.getTime() + VN_TZ_OFFSET_MS);
    const h = String(vn.getUTCHours()).padStart(2, "0");
    const m = String(vn.getUTCMinutes()).padStart(2, "0");
    const d = String(vn.getUTCDate()).padStart(2, "0");
    const mo = String(vn.getUTCMonth() + 1).padStart(2, "0");
    return { time: `${h}:${m}`, date: `${d}/${mo}` };
  } catch {
    return { time: "--:--", date: "--/--" };
  }
}
__name(formatVnTime, "formatVnTime");
function buildM3U(lines, epgUrl) {
  const header = `#EXTM3U url-tvg="${epgUrl}" x-tvg-url="${epgUrl}"`;
  const body = lines.map((l) => `${l.extinf}
${l.url}`).join("\n");
  return `${header}
${body}`;
}
__name(buildM3U, "buildM3U");
function countChannels(lines) {
  return lines.length;
}
__name(countChannels, "countChannels");
function nowSeconds() {
  return Math.floor(Date.now() / 1e3);
}
__name(nowSeconds, "nowSeconds");

// src/phaohoa.ts
var PHAOHOA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Referer": "https://khandai3.link/",
  "Accept": "application/json"
};
function hasStream(match) {
  const commentators = match.commentators || [];
  if (commentators.some(
    (c) => (c.stream_url || c.streamUrl || "").trim()
  )) return true;
  return !!(match.primary_stream_url || "").trim() || !!(match.backup_stream_url || "").trim();
}
__name(hasStream, "hasStream");
function isActive(match) {
  const status = (match.status || "").toLowerCase().trim();
  if (FINISHED_STATUS.has(status)) return false;
  const startStr = match.start_time || "";
  const streamOk = hasStream(match);
  if (!["scheduled", "upcoming", ""].includes(status) && startStr && !streamOk) {
    try {
      const dt = new Date(startStr);
      if (nowSeconds() - Math.floor(dt.getTime() / 1e3) > MATCH_MAX_AGE_SECONDS) return false;
    } catch {
    }
  }
  return true;
}
__name(isActive, "isActive");
function pickStream(match) {
  for (const c of match.commentators || []) {
    const url = (c.stream_url || c.streamUrl || "").trim();
    const name = (c.nickname || c.name || "").trim();
    if (url) return { url, commentator: name };
  }
  const primary = (match.primary_stream_url || "").trim();
  if (primary) return { url: primary, commentator: "" };
  const backup = (match.backup_stream_url || "").trim();
  if (backup) return { url: backup, commentator: "" };
  return { url: "", commentator: "" };
}
__name(pickStream, "pickStream");
async function fetchJson(url, env) {
  const resp = await fetch(url, { headers: PHAOHOA_HEADERS });
  if (!resp.ok) throw new Error(`Kh\xE1n \u0110\xE0i API ${resp.status}`);
  return resp.json();
}
__name(fetchJson, "fetchJson");
async function fetchPhaoHoaLines(env) {
  const apiUrl = env.PHAOHOA_API || "https://khandai3.link/api/matches/";
  const fetchUrl = `${apiUrl.replace(/\/$/, "")}/?ordering=-start_time&page_size=100`;
  const data = await fetchJson(fetchUrl, env);
  let results = (data.results || []).filter((m) => typeof m === "object");
  if (!Array.isArray(results)) throw new Error("Kh\xE1n \u0110\xE0i API invalid results");
  let nextUrl = data.next;
  let page = 2;
  while (nextUrl && page <= 3) {
    try {
      const pageData = await fetchJson(nextUrl, env);
      const pageResults = (pageData.results || []).filter((m) => typeof m === "object");
      results = results.concat(pageResults);
      nextUrl = pageData.next;
      page++;
    } catch {
      break;
    }
  }
  const unique = /* @__PURE__ */ new Map();
  for (const match of results) {
    if (!isActive(match)) continue;
    const key = String(match.id || match.slug || "");
    if (key) unique.set(key, match);
  }
  const sorted = Array.from(unique.values()).sort(
    (a, b) => (a.start_time || "").localeCompare(b.start_time || "")
  );
  const lines = [];
  const frontend = (env.PHAOHOA_FRONTEND || "https://khandai3.link").replace(/\/$/, "");
  for (const match of sorted) {
    if (!isActive(match)) continue;
    const slug = (match.slug || "").trim();
    if (!slug) continue;
    const { url, commentator } = pickStream(match);
    if (!url) continue;
    const home = (match.home_team_name || "Home").trim();
    const away = (match.away_team_name || "Away").trim();
    const tournament = (match.tournament_name || "").trim();
    const logo = logoFromText(`${match.sport_name || ""} ${match.sport_slug || ""} ${tournament}`);
    const { time, date } = formatVnTime(match.start_time || "");
    const status = (match.status || "").toLowerCase().trim();
    const liveLabel = status === "live" ? " LIVE" : "";
    let display = `${time} - ${date} | ${home} VS ${away} (${tournament})`;
    if (commentator) display += ` | ${commentator}`;
    display += liveLabel;
    let streamUrl = url;
    if (!streamUrl.includes("|")) {
      streamUrl += `|Referer=${frontend}/&User-Agent=Mozilla/5.0`;
    }
    lines.push({
      extinf: `#EXTINF:-1 tvg-logo="${logo}" group-title="Ph\xE1o Hoa",${display}`,
      url: streamUrl
    });
  }
  return lines;
}
__name(fetchPhaoHoaLines, "fetchPhaoHoaLines");

// src/phalang.ts
var PHALANG_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Content-Type": "application/json",
  "Accept": "application/json"
};
function phalangIsActive(match) {
  const blv = (match.blv || "").trim();
  if (!blv) return false;
  const startStr = match.start_date || "";
  const isLive = !!match.is_live;
  if (startStr && !isLive) {
    try {
      const dt = new Date(startStr);
      const elapsed = nowSeconds() - Math.floor(dt.getTime() / 1e3);
      if (elapsed > MATCH_MAX_AGE_SECONDS) return false;
    } catch {
    }
  }
  return true;
}
__name(phalangIsActive, "phalangIsActive");
async function fetchPhaLangMatches(env) {
  const api = (env.PHALANG_API || "https://api.plapi202624081158.com").replace(/\/$/, "");
  const url = `${api}/matches/graph`;
  const frontend = (env.PHALANG_LIVE_FRONTEND || "https://phalang.live").replace(/\/$/, "");
  const headers = { ...PHALANG_HEADERS, "Referer": `${frontend}/`, "Origin": frontend };
  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      limit: 100,
      page: 1,
      order_asc: "start_date",
      queries: [
        { field: "is_live", type: "equal", value: true },
        { field: "is_hot", type: "equal", value: true },
        { field: "is_top", type: "equal", value: true }
      ],
      query_or: true
    })
  });
  if (!resp.ok) throw new Error(`PhaLang API ${resp.status}`);
  const data = await resp.json();
  if (typeof data !== "object" || data === null) throw new Error("PhaLang API non-object");
  const results = data.data;
  if (!Array.isArray(results)) throw new Error("PhaLang API invalid data list");
  return results.filter((m) => typeof m === "object");
}
__name(fetchPhaLangMatches, "fetchPhaLangMatches");
async function fetchPhaLangStream(matchId, env) {
  const api = (env.PHALANG_API || "https://api.plapi202624081158.com").replace(/\/$/, "");
  const frontend = (env.PHALANG_LIVE_FRONTEND || "https://phalang.live").replace(/\/$/, "");
  const headers = { ...PHALANG_HEADERS, "Referer": `${frontend}/`, "Origin": frontend };
  try {
    const resp = await fetch(`${api}/match/${matchId}/live`, { headers });
    if (!resp.ok) return "";
    const data = await resp.json();
    for (const key of ["hd_1", "hd_2", "source"]) {
      const url = (data[key] || "").trim();
      if (url) return url;
    }
  } catch {
  }
  return "";
}
__name(fetchPhaLangStream, "fetchPhaLangStream");
async function fetchPhaLangLines(env, baseUrl) {
  const matches = await fetchPhaLangMatches(env);
  const unique = /* @__PURE__ */ new Map();
  for (const match of matches) {
    const key = String(match.id || "");
    if (key) unique.set(key, match);
  }
  const sorted = Array.from(unique.values()).sort(
    (a, b) => (a.start_date || "").localeCompare(b.start_date || "")
  );
  const active = sorted.filter(phalangIsActive);
  const frontend = (env.PHALANG_LIVE_FRONTEND || "https://phalang.live").replace(/\/$/, "");
  const lines = [];
  for (const match of active) {
    const mid = String(match.id || "").trim();
    if (!mid) continue;
    const isLive = !!match.is_live;
    const home = (match.team_1 || "Home").trim();
    const away = (match.team_2 || "Away").trim();
    const league = (match.league || "").trim();
    const commentator = (match.blv || "").trim();
    const logo = logoFromText(`${match.desc || ""} ${league}`);
    const { time, date } = formatVnTime(match.start_date || "");
    const liveLabel = isLive ? " LIVE" : "";
    let display = `${time} - ${date} | ${home} VS ${away} (${league})`;
    if (commentator) display += ` | ${commentator}`;
    display += liveLabel;
    const resolver = `${baseUrl}/phalang/live/${encodeURIComponent(mid)}`;
    const streamUrl = `${resolver}|Referer=${frontend}/&User-Agent=Mozilla/5.0`;
    lines.push({
      extinf: `#EXTINF:-1 tvg-logo="${logo}" group-title="PhaLang",${display}`,
      url: streamUrl
    });
  }
  return lines;
}
__name(fetchPhaLangLines, "fetchPhaLangLines");
async function resolvePhaLangStream(matchId, env) {
  const streamUrl = await fetchPhaLangStream(matchId, env);
  return streamUrl || null;
}
__name(resolvePhaLangStream, "resolvePhaLangStream");

// src/ggsport.ts
var GGSPORT_CATALOG = "sports_football";
async function fetchCatalog(env) {
  const api = (env.GGSPORT_API || "https://sports.highfly.dev").replace(/\/$/, "");
  const url = `${api}/catalog/sport/${GGSPORT_CATALOG}.json`;
  const headers = {};
  if (env.GGSPORT_TOKEN) headers["Authorization"] = `Bearer ${env.GGSPORT_TOKEN}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`GGSport catalog ${resp.status}`);
  const data = await resp.json();
  const metas = data.metas || [];
  return metas.filter((m) => {
    const cats = m.genres || [];
    const cat = (m.category || "").toLowerCase();
    return cats.some((g) => g.toLowerCase() === "football") || cat === "football";
  });
}
__name(fetchCatalog, "fetchCatalog");
async function fetchStream(metaId, env) {
  const api = (env.GGSPORT_API || "https://sports.highfly.dev").replace(/\/$/, "");
  const url = `${api}/stream/sport/${encodeURIComponent(metaId)}.json`;
  const headers = {};
  if (env.GGSPORT_TOKEN) headers["Authorization"] = `Bearer ${env.GGSPORT_TOKEN}`;
  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const data = await resp.json();
    const streams = data.streams || [];
    for (const s of streams) {
      const streamUrl = (s.url || "").trim();
      if (!streamUrl || streamUrl.includes("/health")) continue;
      if (streamUrl.endsWith(".m3u8") || streamUrl.includes(".m3u8")) return streamUrl;
    }
    for (const s of streams) {
      const streamUrl = (s.url || "").trim();
      if (streamUrl && !streamUrl.includes("/health")) return streamUrl;
    }
  } catch {
  }
  return null;
}
__name(fetchStream, "fetchStream");
function parseReleaseInfo(releaseInfo) {
  if (!releaseInfo) return { time: "--:--", date: "--/--", isLive: false };
  const lower = releaseInfo.toLowerCase();
  if (lower.includes("live") && !lower.includes("min")) {
    return { time: "LIVE", date: "", isLive: true };
  }
  try {
    const isoMatch = releaseInfo.match(/(\d{1,2}\s+\w{3}\s+\d{4})\s*[·-]\s*(\d{1,2}:\d{2})\s*(UTC|GMT)/i);
    if (isoMatch) {
      const datePart = isoMatch[1];
      const timePart = isoMatch[2];
      const dt = /* @__PURE__ */ new Date(`${datePart} ${timePart} UTC`);
      if (!isNaN(dt.getTime())) {
        const { time, date } = formatVnTime(dt.toISOString());
        return { time, date, isLive: false };
      }
    }
  } catch {
  }
  return { time: "--:--", date: releaseInfo.substring(0, 10), isLive: false };
}
__name(parseReleaseInfo, "parseReleaseInfo");
async function fetchGGSportLines(env, baseUrl) {
  const metas = await fetchCatalog(env);
  const lines = [];
  for (const meta of metas) {
    const name = meta.name || "Unknown Match";
    const { time, date, isLive } = parseReleaseInfo(meta.releaseInfo || "");
    const logo = meta.poster || logoFromText(name + " football");
    let display = "";
    if (isLive) {
      display = `${name} \u2014 LIVE`;
    } else if (date && time) {
      display = `${time} - ${date} | ${name}`;
    } else {
      display = name;
    }
    lines.push({
      extinf: `#EXTINF:-1 tvg-logo="${logo}" group-title="GGSport Live",${display}`,
      url: `${baseUrl}/ggsport/stream/${encodeURIComponent(meta.id)}`
    });
  }
  return lines;
}
__name(fetchGGSportLines, "fetchGGSportLines");
async function resolveGGSportStream(metaId, env) {
  return await fetchStream(metaId, env);
}
__name(resolveGGSportStream, "resolveGGSportStream");

// src/index.ts
var LEGACY_V322_BASE = "https://e8404aa1-dekiiptv95.bacbenny95.workers.dev";
var CACHE_TTL = 120;
var PHALANG_CACHE_TTL = 120;
var cache = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
function getCached(key, ttl) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Math.floor(Date.now() / 1e3) - entry.builtAt > ttl) return null;
  return entry;
}
__name(getCached, "getCached");
function setCached(key, lines, error) {
  cache.set(key, { lines, builtAt: Math.floor(Date.now() / 1e3), error });
}
__name(setCached, "setCached");
async function fetchWithFallback(key, ttl, fetcher) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const cached = getCached(key, ttl);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const lines = await fetcher();
      setCached(key, lines);
      return { lines, builtAt: Math.floor(Date.now() / 1e3) };
    } catch (err) {
      const stale = cache.get(key);
      if (stale) {
        return { lines: stale.lines, builtAt: stale.builtAt, error: String(err.message || err) };
      }
      setCached(key, [], String(err.message || err));
      return { lines: [], builtAt: Math.floor(Date.now() / 1e3), error: String(err.message || err) };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}
__name(fetchWithFallback, "fetchWithFallback");
function getBaseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
__name(getBaseUrl, "getBaseUrl");
function m3uResponse(text, filename) {
  return new Response(text, {
    headers: {
      "Content-Type": "application/x-mpegurl",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
      "Vary": "Accept-Encoding"
    }
  });
}
__name(m3uResponse, "m3uResponse");
function getGroupTitle(extinf) {
  const match = extinf.match(/group-title="([^"]*)"/i);
  return match ? match[1] : "";
}
__name(getGroupTitle, "getGroupTitle");
function appendLines(target, lines) {
  for (const line of lines) {
    if (!line || !line.extinf || !line.url) continue;
    target.push(line.extinf, line.url);
  }
}
__name(appendLines, "appendLines");
function mergeLegacyPlaylist(text, phalangLines, ggsportLines) {
  const sourceLines = text.split(/\r?\n/);
  const merged = [];
  let insertedPhaLang = false;
  let replacedGGSport = false;
  for (let i = 0; i < sourceLines.length; ) {
    const line = sourceLines[i];
    if (!line.startsWith("#EXTINF:")) {
      merged.push(line);
      i++;
      continue;
    }
    const extinf = line;
    const stream = sourceLines[i + 1] || "";
    const group = getGroupTitle(extinf);
    if (!insertedPhaLang && group === "Giờ Vàng" && phalangLines.length) {
      appendLines(merged, phalangLines);
      insertedPhaLang = true;
    }
    if (group === "GGSport Live" && ggsportLines.length) {
      if (!replacedGGSport) {
        appendLines(merged, ggsportLines);
        replacedGGSport = true;
      }
      i += stream ? 2 : 1;
      continue;
    }
    merged.push(extinf);
    if (stream) merged.push(stream);
    i += stream ? 2 : 1;
  }
  if (!insertedPhaLang && phalangLines.length) {
    const firstEntryIndex = merged.findIndex((line) => line.startsWith("#EXTINF:"));
    const insertAt = firstEntryIndex >= 0 ? firstEntryIndex : merged.length;
    const injected = [];
    appendLines(injected, phalangLines);
    merged.splice(insertAt, 0, ...injected);
  }
  if (ggsportLines.length && !replacedGGSport) appendLines(merged, ggsportLines);
  return merged.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
__name(mergeLegacyPlaylist, "mergeLegacyPlaylist");
async function fetchLegacy(request) {
  const incoming = new URL(request.url);
  const target = `${LEGACY_V322_BASE}${incoming.pathname}${incoming.search}`;
  const headers = new Headers(request.headers);
  headers.set("host", new URL(LEGACY_V322_BASE).host);
  const init = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
  return fetch(target, init);
}
__name(fetchLegacy, "fetchLegacy");
async function buildLegacyMerged(env, request, baseUrl) {
  const legacyResponse = await fetchLegacy(request);
  if (!legacyResponse.ok) {
    throw new Error(`Legacy v322 playlist ${legacyResponse.status}`);
  }
  const legacyText = await legacyResponse.text();
  const [phalangResult, ggsportResult] = await Promise.all([
    fetchWithFallback("phalang", PHALANG_CACHE_TTL, () => fetchPhaLangLines(env, baseUrl)),
    fetchWithFallback("ggsport", CACHE_TTL, () => fetchGGSportLines(env, baseUrl))
  ]);
  const phalangLines = phalangResult.lines || [];
  const ggsportLines = ggsportResult.lines || [];
  const text = mergeLegacyPlaylist(legacyText, phalangLines, ggsportLines);
  const errors = [];
  if (phalangResult.error) errors.push(`phalang: ${phalangResult.error}`);
  if (ggsportResult.error) errors.push(`ggsport: ${ggsportResult.error}`);
  return { text: errors.length ? `${text}# Errors: ${errors.join("; ")}\\n` : text, errors };
}
__name(buildLegacyMerged, "buildLegacyMerged");

async function buildCombined(env, baseUrl) {
  const errors = [];
  const [phaohoaResult, phalangResult, ggsportResult] = await Promise.allSettled([
    fetchWithFallback("phaohoa", CACHE_TTL, () => fetchPhaoHoaLines(env)),
    fetchWithFallback("phalang", PHALANG_CACHE_TTL, () => fetchPhaLangLines(env, baseUrl)),
    fetchWithFallback("ggsport", CACHE_TTL, () => fetchGGSportLines(env, baseUrl))
  ]);
  const phaohoaLines = phaohoaResult.status === "fulfilled" ? phaohoaResult.value.lines : [];
  if (phaohoaResult.status === "rejected") errors.push(`phaohoa: ${phaohoaResult.reason}`);
  else if (phaohoaResult.value.error) errors.push(`phaohoa: ${phaohoaResult.value.error}`);
  const phalangLines = phalangResult.status === "fulfilled" ? phalangResult.value.lines : [];
  if (phalangResult.status === "rejected") errors.push(`phalang: ${phalangResult.reason}`);
  else if (phalangResult.value.error) errors.push(`phalang: ${phalangResult.value.error}`);
  const ggsportLines = ggsportResult.status === "fulfilled" ? ggsportResult.value.lines : [];
  if (ggsportResult.status === "rejected") errors.push(`ggsport: ${ggsportResult.reason}`);
  else if (ggsportResult.value.error) errors.push(`ggsport: ${ggsportResult.value.error}`);
  const ordered = [
    ...phaohoaLines,
    ...phalangLines,
    ...ggsportLines
  ];
  return { lines: ordered, errors };
}
__name(buildCombined, "buildCombined");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const baseUrl = getBaseUrl(request);
    const epgUrl = env.EPG_URL || "https://lichphatsong.io.vn/epg.xml";
    if (path === "/" || path === "/live.m3u") {
      try {
        const { text } = await buildLegacyMerged(env, request, baseUrl);
        return m3uResponse(text, "live.m3u");
      } catch (err) {
        return new Response(`Playlist unavailable: ${String(err.message || err)}`, {
          status: 502,
          headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" }
        });
      }
    }
    if (path === "/ping") {
      return new Response("OK", { headers: { "Content-Type": "text/plain" } });
    }
    if (path === "/status.json") {
      return new Response(JSON.stringify(buildStatus()), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }
    if (path === "/phaohoa.m3u") {
      const result = await fetchWithFallback("phaohoa", CACHE_TTL, () => fetchPhaoHoaLines(env));
      return m3uResponse(buildM3U(result.lines, epgUrl), "phaohoa.m3u");
    }
    if (path === "/phalang.m3u") {
      const result = await fetchWithFallback("phalang", PHALANG_CACHE_TTL, () => fetchPhaLangLines(env, baseUrl));
      return m3uResponse(buildM3U(result.lines, epgUrl), "phalang.m3u");
    }
    if (path === "/ggsport.m3u") {
      const result = await fetchWithFallback("ggsport", CACHE_TTL, () => fetchGGSportLines(env, baseUrl));
      return m3uResponse(buildM3U(result.lines, epgUrl), "ggsport.m3u");
    }
    const phalangMatch = path.match(/^\/phalang\/live\/(.+)$/);
    if (phalangMatch) {
      const matchId = decodeURIComponent(phalangMatch[1]);
      const streamUrl = await resolvePhaLangStream(matchId, env);
      if (!streamUrl) {
        return new Response("Tran chua bat dau / Match not started", {
          status: 503,
          headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "3" }
        });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: streamUrl, "Cache-Control": "no-store" }
      });
    }
    const ggsportMatch = path.match(/^\/ggsport\/stream\/(.+)$/);
    if (ggsportMatch) {
      const metaId = decodeURIComponent(ggsportMatch[1]);
      const streamUrl = await resolveGGSportStream(metaId, env);
      if (!streamUrl) {
        return new Response("Stream not available yet", {
          status: 503,
          headers: { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "30" }
        });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: streamUrl, "Cache-Control": "no-store" }
      });
    }
    return fetchLegacy(request);
  }
};
function buildStatus() {
  const now = Math.floor(Date.now() / 1e3);
  const sources = {};
  for (const key of ["phaohoa", "phalang", "ggsport"]) {
    const entry = cache.get(key);
    sources[key] = {
      channels: entry ? countChannels(entry.lines) : 0,
      built_at: entry ? entry.builtAt : null,
      age_seconds: entry ? now - entry.builtAt : null,
      error: entry?.error || null
    };
  }
  return {
    ok: !Object.values(sources).some((s) => s.error && !s.channels),
    sources,
    cache_ttl: CACHE_TTL
  };
}
__name(buildStatus, "buildStatus");
function statusPage() {
  return `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DekiiPTV95</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.6;padding:2rem}
h2{color:#38bdf8;margin-bottom:1rem}
h3{color:#94a3b8;margin:1.5rem 0 0.5rem}
a{color:#38bdf8;text-decoration:none}
a:hover{text-decoration:underline}
ul{list-style:none;padding-left:0}
li{padding:0.3rem 0;border-bottom:1px solid #1e293b}
code{background:#1e293b;padding:0.2rem 0.4rem;border-radius:4px;font-size:0.9rem}
</style>
</head>
<body>
<h2>DekiiPTV95 \u2014 IPTV M3U Server</h2>
<h3>Playlist</h3><ul>
<li><a href="/live.m3u">/live.m3u</a> \u2014 T\u1EA5t c\u1EA3 ngu\u1ED3n g\u1ED9p (Ph\xE1o Hoa \u2192 PhaLang \u2192 GGSport)</li>
<li><a href="/phaohoa.m3u">/phaohoa.m3u</a> \u2014 Ph\xE1o Hoa (Kh\xE1n \u0110\xE0i TV) only</li>
<li><a href="/phalang.m3u">/phalang.m3u</a> \u2014 PhaLang TV only</li>
<li><a href="/ggsport.m3u">/ggsport.m3u</a> \u2014 GGSport Live (Football) only</li>
</ul>
<h3>Tr\u1EA1ng th\xE1i</h3>
<p><a href="/status.json">/status.json</a> \u2014 Chi ti\u1EBFt tr\u1EA1ng th\xE1i c\xE1c ngu\u1ED3n</p>
<h3>Ngu\u1ED3n</h3><ul>
<li><strong>Ph\xE1o Hoa</strong> (Kh\xE1n \u0110\xE0i TV) \u2014 khandai3.link</li>
<li><strong>PhaLang</strong> TV \u2014 api.plapi202624081158.com</li>
<li><strong>GGSport Live</strong> \u2014 sports.highfly.dev (football only)</li>
</ul>
<h3>Th\xF4ng tin</h3><ul>
<li>Worker ch\u1EA1y tr\xEAn Cloudflare Workers</li>
<li>Cache ${CACHE_TTL}s cho m\u1ED7i ngu\u1ED3n</li>
<li>Th\u1EE9 t\u1EF1 nh\xF3m: Ph\xE1o Hoa \u2192 PhaLang \u2192 GGSport Live</li>
</ul>
</body>
</html>`;
}
__name(statusPage, "statusPage");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
