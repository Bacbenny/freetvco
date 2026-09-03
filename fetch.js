#!/usr/bin/env node
/**
 * freetvco - IPTV stream fetcher for Cò TiVi
 * Fetches encrypted channel/sport data from api.cotivi.site,
 * decrypts with BlowFish (CryptoJS), and generates M3U playlist.
 *
 * App analysis:
 *  - Bundle: Hermes bytecode (React Native / Expo SDK 52)
 *  - Encryption: CryptoJS.Blowfish, padding AnsiX923
 *  - API: https://api.cotivi.site/api/Channels?version=<runtimeVersion>
 *  - Response: { key: "<base64>", data: "<base64-encrypted>" }
 *  - key field decoded: used as BlowFish key
 */

const https = require('https');
const fs   = require('fs');
const path = require('path');
const CryptoJS = require('crypto-js');

const API_BASE   = 'https://api.cotivi.site';
const VERSION    = process.env.COTIVI_VERSION || '1.1.2';
const OUT_DIR    = process.env.OUT_DIR || path.join(__dirname, '../../output');
const DEBUG_DIR  = process.env.DEBUG_DIR || path.join(__dirname, '../../debug');

// ─── helpers ─────────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Cò TiVi/1.1.7' } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error(`JSON parse error from ${url}: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

/**
 * Try every combination of mode / padding / IV until we find valid JSON.
 * Returns the parsed object or null if no combination works.
 */
function tryDecrypt(keyStr, encDataB64) {
  const encDataWA = CryptoJS.enc.Base64.parse(encDataB64);

  const modes = [
    { name: 'CBC', mode: CryptoJS.mode.CBC },
    { name: 'ECB', mode: CryptoJS.mode.ECB },
    { name: 'CFB', mode: CryptoJS.mode.CFB },
  ];
  const paddings = [
    { name: 'AnsiX923',    pad: CryptoJS.pad.AnsiX923 },
    { name: 'Pkcs7',       pad: CryptoJS.pad.Pkcs7 },
    { name: 'ZeroPadding', pad: CryptoJS.pad.ZeroPadding },
    { name: 'NoPadding',   pad: CryptoJS.pad.NoPadding },
  ];
  const ivHexes = [
    '0000000000000000',
    Buffer.from(keyStr.slice(0, 8)).toString('hex'),
    '3132333435363738', // '12345678'
    Buffer.from('cotivi00').toString('hex'),
  ];

  // Key variants (WordArray and passphrase string)
  const keyWordArray = CryptoJS.enc.Utf8.parse(keyStr);
  const keyLower     = CryptoJS.enc.Utf8.parse(keyStr.toLowerCase());

  for (const { name: mName, mode } of modes) {
    for (const { name: pName, pad: padding } of paddings) {
      const ivList = mName === 'ECB' ? [null] : ivHexes;
      for (const ivHex of ivList) {
        for (const keyWA of [keyWordArray, keyLower]) {
          try {
            const opts = { mode, padding };
            if (ivHex) opts.iv = CryptoJS.enc.Hex.parse(ivHex);
            const dec = CryptoJS.Blowfish.decrypt({ ciphertext: encDataWA }, keyWA, opts);
            const text = dec.toString(CryptoJS.enc.Utf8);
            if (text && text.length > 20 && (text[0] === '{' || text[0] === '[')) {
              console.log(`✅ Decrypt OK: mode=${mName} pad=${pName} iv=${ivHex||'none'}`);
              return JSON.parse(text);
            }
          } catch (_) { /* keep trying */ }
        }
      }
    }
  }
  return null;
}

// ─── M3U builder ─────────────────────────────────────────────────────────────

/**
 * Detect stream URL field name from first channel object.
 * Common field names: url, streamUrl, stream_url, link, playUrl, liveUrl
 */
function pickUrl(ch) {
  const candidates = ['url', 'streamUrl', 'stream_url', 'link', 'playUrl', 'liveUrl',
                       'stream', 'hls', 'rtmp', 'src', 'source'];
  for (const c of candidates) if (ch[c]) return ch[c];
  // Fallback: any field containing http
  return Object.values(ch).find(v => typeof v === 'string' && v.startsWith('http')) || '';
}

function buildM3U(channels, groupTitle = 'CoTiVi') {
  let m3u = `#EXTM3U url-tvg="https://lichphatsong.site/schedule/epg.xml.gz"\n`;
  for (const ch of channels) {
    const name  = ch.name || ch.title || ch.channelName || 'Unknown';
    const logo  = ch.logo || ch.icon || ch.thumbnail || ch.image || '';
    const group = ch.group || ch.category || ch.groupName || groupTitle;
    const id    = ch.id || ch.channelId || name.toLowerCase().replace(/\s+/g, '-');
    const url   = pickUrl(ch);
    if (!url) continue;
    m3u += `#EXTINF:-1 tvg-id="${id}" tvg-name="${name}" tvg-logo="${logo}" group-title="${group}",${name}\n`;
    m3u += `${url}\n`;
  }
  return m3u;
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR,   { recursive: true });
  fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const endpoints = [
    { name: 'channels', path: '/api/Channels', outFile: 'cotivi_channels.m3u', group: 'CoTiVi TV' },
    { name: 'sports',   path: '/api/Sports',   outFile: 'cotivi_sports.m3u',   group: 'CoTiVi Sports' },
  ];

  let allChannels = [];
  let decryptOk   = false;

  for (const ep of endpoints) {
    const url = `${API_BASE}${ep.path}?version=${VERSION}`;
    console.log(`\n📡 Fetching ${ep.name}: ${url}`);

    let resp;
    try { resp = await fetchJson(url); }
    catch (e) { console.error(`  ❌ Fetch error: ${e.message}`); continue; }

    // Save raw response for debugging
    fs.writeFileSync(
      path.join(DEBUG_DIR, `${ep.name}_raw.json`),
      JSON.stringify(resp, null, 2)
    );

    if (!resp.key || !resp.data) {
      console.error(`  ❌ Unexpected response format`);
      continue;
    }

    const keyStr = Buffer.from(resp.key, 'base64').toString('utf8');
    console.log(`  🔑 Key field decoded: ${keyStr} (${keyStr.length} chars)`);
    console.log(`  📦 Encrypted data size: ${Buffer.from(resp.data, 'base64').length} bytes`);

    const data = tryDecrypt(keyStr, resp.data);
    if (!data) {
      console.error(`  ❌ All decrypt attempts failed. Raw data saved to debug/${ep.name}_raw.json`);
      console.error(`     → Next step: decompile Hermes bytecode or intercept live traffic`);
      continue;
    }

    decryptOk = true;
    const channels = Array.isArray(data) ? data : (data.channels || data.data || data.items || []);
    console.log(`  ✅ Decrypted ${channels.length} entries`);

    if (channels.length === 0) {
      console.warn(`  ⚠️  No channels found in decrypted data`);
      fs.writeFileSync(path.join(DEBUG_DIR, `${ep.name}_decrypted.json`), JSON.stringify(data, null, 2));
      continue;
    }

    const m3u = buildM3U(channels, ep.group);
    const outPath = path.join(OUT_DIR, ep.outFile);
    fs.writeFileSync(outPath, m3u, 'utf8');
    console.log(`  📺 Saved ${channels.length} channels → ${outPath}`);

    // Save decrypted for inspection
    fs.writeFileSync(
      path.join(DEBUG_DIR, `${ep.name}_decrypted.json`),
      JSON.stringify(channels.slice(0, 3), null, 2)
    );

    allChannels = allChannels.concat(channels.map(ch => ({ ...ch, _group: ep.group })));
  }

  // Combined playlist
  if (allChannels.length > 0) {
    const combined = buildM3U(allChannels, 'CoTiVi');
    fs.writeFileSync(path.join(OUT_DIR, 'cotivi_all.m3u'), combined, 'utf8');
    console.log(`\n📋 Combined playlist: ${allChannels.length} channels → output/cotivi_all.m3u`);
  }

  if (!decryptOk) {
    console.error('\n❌ Decryption failed for all endpoints.');
    console.error('   Possible causes:');
    console.error('   1. Hardcoded key in Hermes bytecode not yet extracted');
    console.error('   2. Different IV / key derivation');
    console.error('   3. Non-CryptoJS BlowFish implementation');
    console.error('\n   Recommended next step: run APK in emulator with mitmproxy to intercept decrypted API calls.');
    process.exit(1);
  }

  console.log('\n✅ Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
