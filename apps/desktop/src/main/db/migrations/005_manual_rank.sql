-- Lets the user assert what a game was worth when attribution cannot know.
--
-- Attribution only writes LP when exactly one ranked game sits between two
-- snapshots (see 003 and rankAttribution.ts). A run of games played with the
-- client closed collapses into a single interval, and every game in it stays
-- blank. The user usually knows the answer; there was no way to say so.
--
-- An edit is stored as a rank_snapshots row rather than a match_rank row, on
-- purpose. match_rank is derived from adjacent snapshot pairs and the graph
-- plots snapshots, so a snapshot written at a game's end time makes the LP
-- chip, the promotion crest, the milestones and the graph all fall out of the
-- machinery that already exists — and replayAttribution recomputes the same
-- value every run, so nothing needs an "is manual, leave it alone" guard.
--
-- It also means asserting the state *after* one game is enough: for three
-- ambiguous games A, B, C, snapshots after A and after B split the run into
-- three single-game intervals, and C resolves on its own.
ALTER TABLE rank_snapshots ADD COLUMN match_id TEXT REFERENCES matches(match_id) ON DELETE CASCADE;

-- Null on every observed reading, and the id of the game being described on a
-- manual one. Carrying the link rather than inferring it from captured_at is
-- what makes clearing an edit a targeted delete and re-editing an UPDATE, so a
-- game cannot accumulate several conflicting snapshots at one timestamp. It
-- also gives the row a key that is independent of how the end-of-game
-- timestamp happens to be computed.
CREATE INDEX idx_rank_snapshots_match ON rank_snapshots(match_id);
