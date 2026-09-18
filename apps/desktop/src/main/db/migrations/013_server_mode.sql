-- The two tables that stay on this machine stop pointing at the ones that leave.
--
-- Connected to a Foxfire Server, accounts and matches live in that server's
-- database. Recordings and replays cannot follow them: an OBS capture and a
-- .rofl are files on one disk, and no server can serve a path on somebody
-- else's PC. So these two tables stay here and their references to the tables
-- that left have to become something that survives the move.
--
-- Three changes, all on the same reasoning.
--
-- account_id becomes TEXT and stops being a foreign key. In local-only mode it
-- still holds this machine's accounts.id, written as text; connected to a
-- server it holds that server's id for the account, which is a GUID. Neither
-- side may constrain it, because half the time the row it names is not in this
-- file at all.
--
-- riot_id comes along beside it, and is the reason the change is safe rather
-- than merely possible. An opaque id from a server means nothing on any other
-- server, and nothing at all in local-only mode — so a recording would be
-- orphaned the moment somebody left a community. game_name#tag_line is the one
-- identity that crosses every one of those boundaries, which is why the server
-- files accounts under it too. Backfilled here from the account each row
-- already names.
--
-- server_key records which server a row was written against, so switching
-- servers cannot mis-attribute footage. NULL means local-only, which is what
-- every existing row is.
--
-- match_id stops being a foreign key for the same reason and keeps its value
-- unchanged: NA1_5312345678 is Riot's id for that game and is valid on any
-- server, in local-only mode, and in a stats.db imported into a server years
-- from now. It was already the durable half of that reference; only the
-- constraint was local.
--
-- SQLite cannot drop a constraint in place, so both tables are rebuilt. The
-- order below matters: recording_events references recordings, so its
-- replacement is built against the new table *before* either old one is
-- dropped, and only then are they renamed into place. Doing it the other way
-- round leaves a dangling reference that the next insert would fail on.

CREATE TABLE recordings_new (
  id INTEGER PRIMARY KEY,

  -- Whose account this was recorded on, as whichever store currently owns
  -- accounts spells it. Not a foreign key: in server mode the row it names is
  -- in SQL Server on somebody's homelab.
  account_id TEXT NOT NULL,

  -- game_name#tag_line at the time of recording. The durable half of the
  -- identity above, and what re-links a recording after a server change, an
  -- import, or a return to local-only.
  riot_id TEXT,

  -- The Foxfire Server this was recorded against, as its URL. NULL for
  -- local-only, which is every row that existed before this migration.
  server_key TEXT,

  -- Riot's own match id. Global, and valid wherever this row ends up, which is
  -- why it needs no constraint to be meaningful.
  match_id TEXT,

  bind_state TEXT NOT NULL DEFAULT 'pending',
  file_path TEXT NOT NULL UNIQUE,
  file_bytes INTEGER,
  queue_id INTEGER,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  game_time_offset REAL NOT NULL DEFAULT 0,
  self_champion_id INTEGER,
  roster_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO recordings_new
  (id, account_id, riot_id, server_key, match_id, bind_state, file_path, file_bytes,
   queue_id, started_at, ended_at, game_time_offset, self_champion_id, roster_json, created_at)
SELECT r.id,
       CAST(r.account_id AS TEXT),
       (SELECT a.game_name || '#' || a.tag_line FROM accounts a WHERE a.id = r.account_id),
       NULL,
       r.match_id,
       r.bind_state,
       r.file_path,
       r.file_bytes,
       r.queue_id,
       r.started_at,
       r.ended_at,
       r.game_time_offset,
       r.self_champion_id,
       r.roster_json,
       r.created_at
  FROM recordings r;

CREATE TABLE recording_events_new (
  recording_id INTEGER NOT NULL REFERENCES recordings_new(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  game_time REAL NOT NULL,
  video_time REAL NOT NULL,
  role TEXT NOT NULL,
  label TEXT,
  PRIMARY KEY (recording_id, event_id)
);

INSERT INTO recording_events_new
  (recording_id, event_id, name, game_time, video_time, role, label)
SELECT recording_id, event_id, name, game_time, video_time, role, label
  FROM recording_events;

-- The child first: dropping a table that references another is always safe,
-- and it is what frees the old recordings table to be dropped next.
DROP TABLE recording_events;
DROP TABLE recordings;

-- Renaming rewrites recording_events_new's reference to point at the new name,
-- which is why the reference was written against recordings_new above.
ALTER TABLE recordings_new RENAME TO recordings;
ALTER TABLE recording_events_new RENAME TO recording_events;

CREATE INDEX idx_recordings_match ON recordings(match_id);
CREATE INDEX idx_recordings_account ON recordings(account_id, started_at DESC);
CREATE INDEX idx_recordings_bindable ON recordings(bind_state, started_at)
  WHERE bind_state IN ('pending', 'unmatched');
CREATE INDEX idx_recording_events_time ON recording_events(recording_id, video_time);

CREATE TABLE replays_new (
  id INTEGER PRIMARY KEY,
  match_id TEXT,

  -- NULL still means "not established yet" rather than "nobody" — a .rofl does
  -- not say whose it is until the match it names has been fetched.
  account_id TEXT,
  riot_id TEXT,
  server_key TEXT,

  file_path TEXT NOT NULL UNIQUE,
  source_path TEXT UNIQUE,
  file_bytes INTEGER,
  game_version TEXT,
  patch TEXT,
  duration_seconds INTEGER,
  recorded_at INTEGER NOT NULL,
  deleted_at INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO replays_new
  (id, match_id, account_id, riot_id, server_key, file_path, source_path, file_bytes,
   game_version, patch, duration_seconds, recorded_at, deleted_at, created_at)
SELECT r.id,
       r.match_id,
       CASE WHEN r.account_id IS NULL THEN NULL ELSE CAST(r.account_id AS TEXT) END,
       (SELECT a.game_name || '#' || a.tag_line FROM accounts a WHERE a.id = r.account_id),
       NULL,
       r.file_path,
       r.source_path,
       r.file_bytes,
       r.game_version,
       r.patch,
       r.duration_seconds,
       r.recorded_at,
       r.deleted_at,
       r.created_at
  FROM replays r;

DROP TABLE replays;
ALTER TABLE replays_new RENAME TO replays;

CREATE INDEX idx_replays_match ON replays(match_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_replays_account ON replays(account_id, recorded_at DESC);
