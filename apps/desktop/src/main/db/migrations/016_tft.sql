-- Teamfight Tactics, beside League.
--
-- A game is a Riot title played on the same Riot ID, so it is a column on what
-- every game shares rather than a second database: a TFT match is a row in
-- matches like any other, which is what lets match_rank, a hand-entered reading
-- and a recording reach it by the keys they already use. Everything already
-- here is League's, and says so through each column's default.
--
-- Every League read starts from match_participants by puuid, and a TFT game
-- has no rows there — its boards are in tft_participants — so none of those
-- reads can see one.

ALTER TABLE matches ADD COLUMN game TEXT NOT NULL DEFAULT 'lol';
ALTER TABLE matches ADD COLUMN tft_set_number INTEGER;
ALTER TABLE matches ADD COLUMN tft_set_core_name TEXT;
CREATE INDEX idx_matches_game ON matches(game, game_creation);

-- One player's board in one TFT game.
--
-- The traits, units and augments are Foxfire's own camelCase JSON, not Riot's,
-- read whole to draw a row and never queried inside; raw_json on the match keeps
-- Riot's payload.
CREATE TABLE tft_participants (
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  -- Under whichever key fetched the game: the main key's, or a TFT key's when
  -- this PC has one. See account_scoped_puuids.
  puuid TEXT NOT NULL,
  game_name TEXT,
  tag_line TEXT,
  placement INTEGER NOT NULL,
  -- The team's place, 1 to 4, in Double Up; worked out from the whole lobby on
  -- the way in. NULL in every other queue.
  team_placement INTEGER,
  partner_group_id INTEGER,
  level INTEGER NOT NULL DEFAULT 0,
  last_round INTEGER NOT NULL DEFAULT 0,
  -- Seconds, fractional as Riot sends them, from the start until this player
  -- was knocked out. Where attribution places the game: TFT moves LP at the
  -- elimination, not when the last player in the lobby finishes.
  time_eliminated REAL NOT NULL DEFAULT 0,
  players_eliminated INTEGER NOT NULL DEFAULT 0,
  total_damage_to_players INTEGER NOT NULL DEFAULT 0,
  gold_left INTEGER NOT NULL DEFAULT 0,
  win INTEGER NOT NULL DEFAULT 0,
  traits_json TEXT NOT NULL DEFAULT '[]',
  units_json TEXT NOT NULL DEFAULT '[]',
  augments_json TEXT,
  PRIMARY KEY (match_id, puuid)
);
CREATE INDEX idx_tft_participants_puuid ON tft_participants(puuid);

-- Hyper Roll is measured by a colour and a rating rather than a tier, a
-- division and LP. Its ladder_position is the rating.
ALTER TABLE league_entries ADD COLUMN rated_tier TEXT;
ALTER TABLE league_entries ADD COLUMN rated_rating INTEGER;
ALTER TABLE rank_snapshots ADD COLUMN rated_tier TEXT;
ALTER TABLE rank_snapshots ADD COLUMN rated_rating INTEGER;
ALTER TABLE match_rank ADD COLUMN rated_tier_before TEXT;
ALTER TABLE match_rank ADD COLUMN rated_tier_after TEXT;

-- A sync per account and per game: each has its own newest game, its own
-- backfill and its own times, and one finishing says nothing about the other.
CREATE TABLE sync_state_by_game (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  game TEXT NOT NULL DEFAULT 'lol',
  most_recent_match_id TEXT,
  backfill_complete INTEGER NOT NULL DEFAULT 0,
  backfill_target INTEGER NOT NULL DEFAULT 200,
  last_full_sync_at TEXT,
  last_delta_sync_at TEXT,
  PRIMARY KEY (account_id, game)
);
INSERT INTO sync_state_by_game
  (account_id, game, most_recent_match_id, backfill_complete, backfill_target, last_full_sync_at, last_delta_sync_at)
SELECT account_id, 'lol', most_recent_match_id, backfill_complete, backfill_target, last_full_sync_at, last_delta_sync_at
  FROM sync_state;
DROP TABLE sync_state;
ALTER TABLE sync_state_by_game RENAME TO sync_state;

-- Seasons are one game's at a time: League's seasons and TFT's sets open on
-- different days, and the same instant can be both. Rebuilt rather than
-- altered, because the UNIQUE on starts_at has to become one per game. The ids
-- are copied across as they were, since an id is what a picked period is
-- written as (`season:12`) — a link or a remembered picker must keep naming the
-- same season.
CREATE TABLE seasons_by_game (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL DEFAULT 'lol',
  label TEXT NOT NULL,
  starts_at INTEGER NOT NULL,
  is_preseason INTEGER NOT NULL DEFAULT 0,
  resets_rank INTEGER NOT NULL DEFAULT 1,
  UNIQUE (game, starts_at)
);
INSERT INTO seasons_by_game (id, game, label, starts_at, is_preseason, resets_rank)
SELECT id, 'lol', label, starts_at, is_preseason, resets_rank FROM seasons;
DROP TABLE seasons;
ALTER TABLE seasons_by_game RENAME TO seasons;
CREATE INDEX idx_seasons_game_starts_at ON seasons(game, starts_at);

-- TFT's sets from Set 13, which is as far back as a backfill reaches, at
-- midnight UTC on launch day — the same instants a Foxfire Server seeds. Each
-- reset the ladder. Settings › Rank tracking corrects them or adds older ones.
INSERT INTO seasons (game, label, starts_at, is_preseason, resets_rank) VALUES
  ('tft', 'Set 13', 1732060800000, 0, 1),
  ('tft', 'Set 14', 1743552000000, 0, 1),
  ('tft', 'Set 15', 1753833600000, 0, 1),
  ('tft', 'Set 16', 1764720000000, 0, 1),
  ('tft', 'Set 17', 1776211200000, 0, 1),
  ('tft', 'Set 18', 1787702400000, 0, 1);

-- An account's id under a TFT key of its own.
--
-- Riot encrypts a puuid against the key that asked for it, so with a separate
-- TFT key the same player is a different string to TFT's API. There is a row
-- here only while this PC has a TFT key; without one TFT uses the main key and
-- accounts.puuid. A retired id records its scope too, so a dead TFT id is
-- recognised as the TFT one it was.
CREATE TABLE account_scoped_puuids (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  puuid TEXT NOT NULL,
  PRIMARY KEY (account_id, scope),
  UNIQUE (scope, puuid)
);
ALTER TABLE account_puuids ADD COLUMN scope TEXT NOT NULL DEFAULT 'main';

-- Which game a recording is of, and the game the League client said it was —
-- what binds a TFT recording to its match by id rather than by guesswork.
ALTER TABLE recordings ADD COLUMN game TEXT NOT NULL DEFAULT 'lol';
ALTER TABLE recordings ADD COLUMN game_id INTEGER;
ALTER TABLE recordings ADD COLUMN platform_id TEXT;
CREATE INDEX idx_recordings_account_game ON recordings(account_id, game, started_at DESC);
