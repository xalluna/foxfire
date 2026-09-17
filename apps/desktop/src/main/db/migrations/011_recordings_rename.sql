-- The word "replay" is given back to Riot.
--
-- Everything this table has ever held is an OBS video capture of a game from the
-- player's own point of view. Riot has its own replay system — a .rofl file per
-- game, played back inside the League client with full camera control and every
-- player's perspective — and Foxfire now carries those too. Two genuinely
-- different artefacts cannot share one name, and the one that was here first is
-- the one that was misnamed: a video of your screen is a recording.
--
-- So the name is freed here, in its own migration, before 012 creates the table
-- that actually deserves it. The two files must stay in this order, and neither
-- may be renamed afterwards: schema_migrations keys off the filename, so a file
-- that changes its name is a migration that runs twice.
--
-- SQLite rewrites recording_events' foreign-key reference to the renamed table
-- on its own (legacy_alter_table is off), so nothing here needs foreign keys
-- switched off — which matters, because the runner wraps every migration in a
-- transaction and PRAGMA foreign_keys does nothing inside one.

ALTER TABLE replays RENAME TO recordings;
ALTER TABLE replay_events RENAME TO recording_events;
ALTER TABLE recording_events RENAME COLUMN replay_id TO recording_id;

-- Indexes survive a table rename carrying their old names. Rebuild them so
-- nothing left in the schema says "replay" about a recording.
DROP INDEX IF EXISTS idx_replays_match;
DROP INDEX IF EXISTS idx_replays_account;
DROP INDEX IF EXISTS idx_replays_bindable;
DROP INDEX IF EXISTS idx_replay_events_time;

CREATE INDEX idx_recordings_match ON recordings(match_id);
CREATE INDEX idx_recordings_account ON recordings(account_id, started_at DESC);
CREATE INDEX idx_recordings_bindable ON recordings(bind_state, started_at)
  WHERE bind_state IN ('pending', 'unmatched');
CREATE INDEX idx_recording_events_time ON recording_events(recording_id, video_time);
