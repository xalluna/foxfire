-- Gameplay recordings, and the events that make them seekable.
--
-- A recording is created the moment OBS confirms it started, long before the
-- match it belongs to exists anywhere: match-v5 publishes minutes after the
-- game ends. So match_id starts NULL and is filled in later by roster
-- fingerprinting, and bind_state records how that went.

CREATE TABLE replays (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- SET NULL rather than CASCADE: deleting a match must not destroy footage.
  -- The replay falls back to the unmatched state and stays watchable.
  match_id TEXT REFERENCES matches(match_id) ON DELETE SET NULL,
  bind_state TEXT NOT NULL DEFAULT 'pending',

  -- Absolute, because the replay folder is user-chosen and can be moved to
  -- another drive. UNIQUE so a retried bookkeeping write cannot list one file
  -- twice.
  file_path TEXT NOT NULL UNIQUE,
  file_bytes INTEGER,

  queue_id INTEGER,

  -- Epoch milliseconds, the same units as matches.game_creation.
  started_at INTEGER NOT NULL,
  ended_at INTEGER,

  -- The game clock, in seconds, at the instant recording actually began. Every
  -- event's position in the video is its game time minus this. Stored rather
  -- than derived because the game clock is the only shared reference between
  -- the video and the event stream, and it is not zero at the first frame:
  -- recording starts when the game first answers on loopback, which is already
  -- a few seconds in.
  game_time_offset REAL NOT NULL DEFAULT 0,

  self_champion_id INTEGER,

  -- The ten champion ids seen in the live game, used to identify the match once
  -- it syncs. End times alone are not enough — two games finishing within a few
  -- minutes of each other are common on a duo night.
  roster_json TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_replays_match ON replays(match_id);
CREATE INDEX idx_replays_account ON replays(account_id, started_at DESC);
CREATE INDEX idx_replays_pending ON replays(bind_state) WHERE bind_state = 'pending';

-- One row per event involving the tracked player.
--
-- The game serves its whole event list on every poll, so the primary key is the
-- game's own EventID and every write is an INSERT OR IGNORE. That makes the
-- poll idempotent and means a crash costs one interval rather than the timeline.
CREATE TABLE replay_events (
  replay_id INTEGER NOT NULL REFERENCES replays(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  game_time REAL NOT NULL,
  video_time REAL NOT NULL,
  role TEXT NOT NULL,
  label TEXT,
  PRIMARY KEY (replay_id, event_id)
);

CREATE INDEX idx_replay_events_time ON replay_events(replay_id, video_time);
