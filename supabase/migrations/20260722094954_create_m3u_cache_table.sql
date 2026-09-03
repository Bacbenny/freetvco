/*
# Create m3u_cache table for edge function auto-updated playlists

1. Purpose
   - The `cotivi-m3u` edge function fetches + decrypts channel/sport data from
     api.cotivi.site and builds M3U playlists on-the-fly.
   - This table caches the generated M3U text so repeated requests within the
     TTL window (5 minutes) don't re-hit the upstream API.
   - This replaces the GitHub Actions workflow dependency — the worker now gets
     fresh playlists directly from the edge function.

2. New Tables
   - `m3u_cache`
     - `id` (text, primary key) — playlist key: "all", "channels", "sports"
     - `content` (text) — full M3U playlist text
     - `channel_count` (integer) — number of #EXTINF entries
     - `updated_at` (timestamptz) — when the cache was last refreshed

3. Security
   - RLS enabled.
   - Public read/write for anon + authenticated (single-tenant, no auth — the
     edge function uses the service role key and bypasses RLS, but we allow
     anon access for any direct queries).
*/

CREATE TABLE IF NOT EXISTS m3u_cache (
  id text PRIMARY KEY,
  content text NOT NULL DEFAULT '',
  channel_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE m3u_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_m3u_cache" ON m3u_cache;
CREATE POLICY "anon_read_m3u_cache" ON m3u_cache FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_write_m3u_cache" ON m3u_cache;
CREATE POLICY "anon_write_m3u_cache" ON m3u_cache FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_m3u_cache" ON m3u_cache;
CREATE POLICY "anon_update_m3u_cache" ON m3u_cache FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_m3u_cache" ON m3u_cache;
CREATE POLICY "anon_delete_m3u_cache" ON m3u_cache FOR DELETE
  TO anon, authenticated USING (true);
