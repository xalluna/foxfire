CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  puuid TEXT NOT NULL UNIQUE,
  game_name TEXT NOT NULL,
  tag_line TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'na1',
  regional_route TEXT NOT NULL DEFAULT 'americas',
  summoner_id TEXT,
  profile_icon_id INTEGER,
  summoner_level INTEGER,
  is_home_account INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE league_entries (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  queue_type TEXT NOT NULL,
  tier TEXT,
  rank TEXT,
  league_points INTEGER,
  wins INTEGER,
  losses INTEGER,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, queue_type)
);

CREATE TABLE matches (
  match_id TEXT PRIMARY KEY,
  game_creation INTEGER NOT NULL,
  game_duration INTEGER NOT NULL,
  game_mode TEXT,
  game_type TEXT,
  queue_id INTEGER,
  platform_id TEXT,
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_matches_game_creation ON matches(game_creation);

CREATE TABLE match_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(match_id) ON DELETE CASCADE,
  puuid TEXT NOT NULL,
  game_name TEXT,
  tag_line TEXT,
  team_id INTEGER NOT NULL,
  win INTEGER NOT NULL,
  champion_id INTEGER NOT NULL,
  champion_name TEXT,
  champ_level INTEGER,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  gold_earned INTEGER,
  cs INTEGER,
  damage_dealt_to_champions INTEGER,
  damage_taken INTEGER,
  items_json TEXT,
  summoner1_id INTEGER,
  summoner2_id INTEGER,
  perks_json TEXT,
  team_position TEXT,
  UNIQUE(match_id, puuid)
);
CREATE INDEX idx_participants_puuid ON match_participants(puuid);
CREATE INDEX idx_participants_match ON match_participants(match_id);

CREATE TABLE champion_mastery (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  champion_id INTEGER NOT NULL,
  champion_points INTEGER,
  champion_level INTEGER,
  last_play_time INTEGER,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, champion_id)
);

CREATE TABLE sync_state (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  most_recent_match_id TEXT,
  backfill_complete INTEGER NOT NULL DEFAULT 0,
  backfill_target INTEGER NOT NULL DEFAULT 200,
  last_full_sync_at TEXT,
  last_delta_sync_at TEXT
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
