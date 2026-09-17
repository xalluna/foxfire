-- Recordings written off as unmatched are looked at again.
--
-- 'unmatched' used to be the end of the line: the binding pass only ever read
-- rows still marked 'pending', so nothing could revisit one. That made the
-- decision permanent on the strength of a single pass — and that pass gives up
-- purely on how long ago the recording finished, with no idea whether syncing
-- was even working at the time. An API key that expired overnight is enough to
-- push every recording made since past the deadline before the app has managed
-- one successful look.
--
-- So the pass now reads both states, bounded by how recently the recording
-- finished, and this index is widened to match. The old one covered only
-- 'pending' and would have been skipped entirely by the new query.
DROP INDEX IF EXISTS idx_replays_pending;

CREATE INDEX idx_replays_bindable ON replays(bind_state, started_at)
  WHERE bind_state IN ('pending', 'unmatched');
