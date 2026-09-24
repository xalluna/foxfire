-- Recordings on YouTube.
--
-- A recording can now have a copy on YouTube, put there by Foxfire or linked by
-- hand, and that copy outlives the file: deleting the mp4 to free the disk keeps
-- the row, the markers and the video, so the recording still plays. What
-- changes is where from.

-- The YouTube copy. Null until there is one.
ALTER TABLE recordings ADD COLUMN youtube_video_id TEXT;

-- public, unlisted or private, as YouTube reported it back — which is not
-- always what was asked for. An unaudited Google project has every upload
-- forced to private, and youtube_forced_private records that it happened so
-- the app can say why nobody else can watch it.
ALTER TABLE recordings ADD COLUMN youtube_privacy TEXT;
ALTER TABLE recordings ADD COLUMN youtube_forced_private INTEGER NOT NULL DEFAULT 0;

-- 'upload' when Foxfire put it there, 'link' when somebody pasted one.
ALTER TABLE recordings ADD COLUMN youtube_source TEXT;
ALTER TABLE recordings ADD COLUMN youtube_title TEXT;
ALTER TABLE recordings ADD COLUMN youtube_at INTEGER;

-- Set when the file was deleted on purpose. Distinct from a file that went
-- missing behind the app's back, which is still reported as missing: this one
-- is gone because somebody asked, and the row stays because it is on YouTube.
ALTER TABLE recordings ADD COLUMN file_deleted_at INTEGER;

-- The upload queue. One row per recording being put on YouTube, kept after it
-- finishes so the Recordings tab can say what happened to it.
--
-- YouTube's resumable protocol is why this is a table and not a promise: an
-- upload of a two-gigabyte game survives a restart, a game (the queue pauses
-- for one), and a dropped connection, by asking the session URI how much
-- arrived and carrying on from there. The URI is good for about a week.
CREATE TABLE youtube_uploads (
  recording_id INTEGER PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,

  -- queued, uploading, paused, waiting_quota, waiting_auth, failed, done, cancelled
  state TEXT NOT NULL,

  -- 'manual' from the upload form, 'auto' from the after-each-game setting.
  trigger TEXT NOT NULL,

  title TEXT NOT NULL,
  description TEXT NOT NULL,
  privacy TEXT NOT NULL,

  file_bytes INTEGER,
  session_uri TEXT,
  confirmed_offset INTEGER NOT NULL DEFAULT 0,

  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error TEXT,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_youtube_uploads_state ON youtube_uploads(state, created_at);

-- Which servers have been told about a recording's video.
--
-- Per server, because the same recording can be attached on each server its
-- player's account is on. And kept once attached, even after somebody removes
-- it on the server: the reconcile pass only attaches what has no row here, so a
-- deliberate removal is not quietly undone by the next sync.
CREATE TABLE recording_attachments (
  recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  server_key TEXT NOT NULL,
  riot_account_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  video_id TEXT NOT NULL,

  -- attached, conflict (the game already had one), not_owner, failed
  state TEXT NOT NULL,
  message TEXT,
  updated_at INTEGER NOT NULL,

  PRIMARY KEY (recording_id, server_key)
);
