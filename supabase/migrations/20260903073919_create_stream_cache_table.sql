/*
# Create stream cache table for hoofoot-proxy edge function

1. New Tables
- `stream_cache` — key-value store for caching hoofoot.ru stream URLs and HLS manifests.
- `cache_key` (text, primary key) — composite key like "stream:<channelId>:<server>" or "manifest:<url>"
- `cache_value` (text) — the cached value (stream URL or rewritten manifest body)
- `expires_at` (timestamptz) — when this entry expires
- `updated_at` (timestamptz) — when this entry was last written

2. Security
- Enable RLS on `stream_cache`.
- Allow anon + authenticated full CRUD — this is a temporary cache table used by the edge function, no sensitive data.
*/

CREATE TABLE IF NOT EXISTS stream_cache (
  cache_key text PRIMARY KEY,
  cache_value text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE stream_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_stream_cache" ON stream_cache;
CREATE POLICY "anon_select_stream_cache" ON stream_cache FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_stream_cache" ON stream_cache;
CREATE POLICY "anon_insert_stream_cache" ON stream_cache FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_stream_cache" ON stream_cache;
CREATE POLICY "anon_update_stream_cache" ON stream_cache FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_stream_cache" ON stream_cache;
CREATE POLICY "anon_delete_stream_cache" ON stream_cache FOR DELETE
  TO anon, authenticated USING (true);

-- Index for fast expiry-based cleanup
CREATE INDEX IF NOT EXISTS idx_stream_cache_expires_at ON stream_cache (expires_at);
