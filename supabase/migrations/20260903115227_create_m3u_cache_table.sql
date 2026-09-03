CREATE TABLE IF NOT EXISTS m3u_cache (
  id text PRIMARY KEY,
  content text NOT NULL,
  channel_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE m3u_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_m3u_cache" ON m3u_cache;
CREATE POLICY "anon_select_m3u_cache" ON m3u_cache FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_m3u_cache" ON m3u_cache;
CREATE POLICY "anon_insert_m3u_cache" ON m3u_cache FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_m3u_cache" ON m3u_cache;
CREATE POLICY "anon_update_m3u_cache" ON m3u_cache FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_m3u_cache" ON m3u_cache;
CREATE POLICY "anon_delete_m3u_cache" ON m3u_cache FOR DELETE
  TO anon, authenticated USING (true);
