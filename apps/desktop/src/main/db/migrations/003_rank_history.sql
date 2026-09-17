-- Rank has only ever existed as a single current-value row per queue
-- (league_entries, keyed on account_id + queue_type and upserted in place), so
-- every refresh destroyed the previous value and no history survived. These
-- tables are append-only instead: snapshots accumulate, and match_rank records
-- what an individual game was worth once two snapshots bracket it.
--
-- Riot exposes no per-match LP, so nothing here can be backfilled — unlike the
-- 002 multi-kill backfill, matches stored before this migration have no
-- recoverable LP or tier and are left empty on purpose.
CREATE TABLE rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  queue_type TEXT NOT NULL,
  tier TEXT,
  rank TEXT,
  league_points INTEGER,
  wins INTEGER,
  losses INTEGER,
  -- Tier, division and LP folded into one continuous number by shared/ladder.ts
  -- and stamped on write, so plotting a graph never has to recompute it.
  ladder_position INTEGER,
  -- 'lcu' when read from the running League client, 'league_v4' from the API.
  source TEXT NOT NULL,
  -- Epoch milliseconds rather than the TEXT datetime used elsewhere in this
  -- schema: this column is compared directly against matches.game_creation to
  -- decide which games fall between two snapshots, and matching units keeps
  -- that predicate index-friendly instead of wrapping it in strftime().
  captured_at INTEGER NOT NULL
);

-- Every read walks one account's snapshots for one queue in time order.
CREATE INDEX idx_rank_snapshots_lookup
  ON rank_snapshots(account_id, queue_type, captured_at);

-- What one game was worth. Written only when exactly one ranked game sits
-- between two consecutive snapshots, so a row here is always an exact
-- measurement rather than an estimate spread across several games.
CREATE TABLE match_rank (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  queue_type TEXT NOT NULL,
  tier_before TEXT,
  rank_before TEXT,
  lp_before INTEGER,
  tier_after TEXT,
  rank_after TEXT,
  lp_after INTEGER,
  lp_delta INTEGER,
  is_promotion INTEGER NOT NULL DEFAULT 0,
  is_demotion INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, account_id)
);

-- For LP attribution, which looks up the ranked games between two snapshots and
-- has no puuid-shaped entry point to start from. Verified with EXPLAIN QUERY
-- PLAN: that query drives off this index.
--
-- The queue-filtered match list and champion win rates do NOT use it — both
-- start from match_participants by puuid and reach matches by primary key,
-- which is already the better plan.
CREATE INDEX idx_matches_queue_id ON matches(queue_id);
