import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const addonBaseUrl = "https://sports.highfly.dev";
const catalogs = ["sports_live", "sports_today"];
const outputPath = join(dirname(fileURLToPath(import.meta.url)), "..", "sports-highfly.m3u");
const requestHeaders = {
  accept: "application/json",
  "user-agent": "Bacbenny/freetvco-sports-playlist/1.0",
};

async function fetchJson(url) {
  let lastError = "";

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { headers: requestHeaders });
    if (response.ok) {
      return response.json();
    }

    lastError = `${response.status} ${response.statusText}`;
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`${lastError}: ${url}`);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const waitSeconds =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter
        : Math.min(15, 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }

  throw new Error(`${lastError}: ${url}`);
}

function cleanAttribute(value) {
  return String(value).replaceAll('"', "'").replaceAll(/\s+/g, " ").trim();
}

function isPlayableStream(stream) {
  return Boolean(
    stream?.url &&
      /^https?:\/\//i.test(stream.url) &&
      /\.(m3u8|mpd)(?:[?#]|$)/i.test(stream.url),
  );
}

const metasById = new Map();
for (const catalog of catalogs) {
  const response = await fetchJson(`${addonBaseUrl}/catalog/sport/${catalog}.json`);
  for (const meta of response.metas ?? []) {
    metasById.set(meta.id, meta);
  }
}

const lines = [];
const seenUrls = new Set();

for (const meta of metasById.values()) {
  const response = await fetchJson(
    `${addonBaseUrl}/stream/sport/${encodeURIComponent(meta.id)}.json`,
  );

  for (const stream of response.streams ?? []) {
    if (!isPlayableStream(stream) || seenUrls.has(stream.url)) {
      continue;
    }

    seenUrls.add(stream.url);
    const name = cleanAttribute(meta.name || stream.name || meta.id);
    const group = cleanAttribute(meta.genres?.[0] || "Sports");
    const logo = meta.poster
      ? ` tvg-logo="${cleanAttribute(meta.poster)}"`
      : "";
    lines.push(
      `#EXTINF:-1 tvg-id="${cleanAttribute(meta.id)}" tvg-name="${name}"${logo} group-title="${group}",${name}`,
      stream.url,
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
}

if (lines.length === 0) {
  throw new Error("No playable streams were found; refusing to overwrite the playlist.");
}

const playlist = [
  "#EXTM3U",
  `# Generated from ${addonBaseUrl}/manifest.json`,
  `# Generated at ${new Date().toISOString()}`,
  ...lines,
  "",
].join("\n");

await writeFile(outputPath, playlist, "utf8");
console.log(`Wrote ${lines.length / 2} playable streams to ${outputPath}`);