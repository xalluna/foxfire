-- Recordings go to the server's Foxfire Media rather than to YouTube.
--
-- YouTube never shipped in a release build, so what 014 kept for it is a
-- developer's test rows at most, and none of it means anything to a server:
-- the YouTube columns go, and the two that carry over are renamed for what
-- they mean now — the server's copy of a recording, as this PC last heard.

DROP TABLE recording_attachments;
DROP TABLE youtube_uploads;

ALTER TABLE recordings DROP COLUMN youtube_privacy;
ALTER TABLE recordings DROP COLUMN youtube_forced_private;
ALTER TABLE recordings DROP COLUMN youtube_source;
ALTER TABLE recordings DROP COLUMN youtube_title;

-- Foxfire Media's id for the video, once the server said it was ready; which
-- server (its URL, as server_key spells it); and when. A YouTube id is not one.
ALTER TABLE recordings RENAME COLUMN youtube_video_id TO server_video_id;
ALTER TABLE recordings RENAME COLUMN youtube_at TO server_video_at;
ALTER TABLE recordings ADD COLUMN server_video_key TEXT;
UPDATE recordings SET server_video_id = NULL, server_video_at = NULL;

-- file_deleted_at stays, and means what it always did: the file was deleted on
-- purpose — now "delete after upload" — and the row kept, because the
-- recording plays from the server.

-- The upload queue. One row per recording going to the server, kept after it
-- finishes so the Recordings tab can say what happened to it.
--
-- The bytes go to Foxfire Media over tus with a one-time token the server
-- mints; the token itself is a credential and lives in the secret store, not
-- here. What is here is enough to carry on after a restart: the upload's own
-- URL on Foxfire Media, and how much of the file it has confirmed.
CREATE TABLE media_uploads (
  recording_id INTEGER PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE,

  -- The server it is going to. A switch of server holds it until that one is back.
  server_key TEXT NOT NULL,

  -- queued, uploading, paused, processing, failed, done, cancelled
  state TEXT NOT NULL,

  -- 'manual' from a row, 'bulk' from select-all or Settings, 'auto' after a game.
  trigger TEXT NOT NULL,

  -- Delete the file from this PC once the server says the video is ready —
  -- decided when it was queued, so changing the setting later does not reach
  -- back into a batch of 500 GB already on its way.
  delete_after INTEGER NOT NULL DEFAULT 0,

  -- The file as it was queued. A file that changed since is not deleted.
  file_bytes INTEGER,
  file_mtime INTEGER,

  -- Foxfire Media's video, and this upload's address on its tus endpoint.
  video_id TEXT,
  upload_url TEXT,
  confirmed_offset INTEGER NOT NULL DEFAULT 0,

  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error TEXT,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_media_uploads_state ON media_uploads(state, created_at);
