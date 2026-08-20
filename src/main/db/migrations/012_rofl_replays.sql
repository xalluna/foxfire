-- Riot's own replays, and the game installs that can still play them.
--
-- This table takes the name migration 011 freed one step earlier. It is a
-- different thing from what used to be called `replays`: not a video of the
-- player's screen, but Riot's .rofl file, which the League client plays back
-- with full camera control. Foxfire never renders one — Riot's player already
-- works, and there is no sense rebuilding it.
--
-- The two features look alike from a distance and are almost nothing alike up
-- close, which is why they get separate tables rather than a `kind` column:
-- nearly every column on `recordings` (the game clock offset, the live roster,
-- the bind state) is meaningless here, `recording_events` cascades off that
-- table alone, and one shared table would mean every existing query silently
-- growing a filter it could forget.

CREATE TABLE replays (
  id INTEGER PRIMARY KEY,

  -- Deliberately NOT a foreign key, and deliberately not accompanied by a bind
  -- state. Riot names its files NA1-5312345678.rofl and matches.match_id is
  -- NA1_5312345678, so the link is a string swap known the instant the file
  -- appears — minutes before match-v5 publishes the match it points at. A LEFT
  -- JOIN answers "is it linked yet"; the answer changes by itself the moment
  -- the match syncs. There is no binding pass, no retry horizon, and nothing
  -- that can be left in a wrong state by a sync that never ran.
  --
  -- NULL only when the file's name told us nothing and its header could not be
  -- fingerprinted against a stored match.
  match_id TEXT,

  -- Which of the player's accounts this belongs to, resolved from the match's
  -- participants once it syncs. One machine has one replay folder, but Foxfire
  -- has many accounts, and the file itself does not say whose it is. NULL means
  -- "not established yet" rather than "nobody".
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,

  -- Foxfire's own copy. Absolute, and UNIQUE so a retried write cannot list one
  -- file twice — the same reasoning as recordings.file_path.
  file_path TEXT NOT NULL UNIQUE,

  -- Riot's original, which we copied from and never modify. This is the
  -- watcher's dedupe key: it is how a folder scan knows it has already seen a
  -- file. NULL for a replay the user added by hand from somewhere else.
  source_path TEXT UNIQUE,

  file_bytes INTEGER,

  -- Straight off the .rofl header, e.g. "15.16.700.1234", and the major.minor
  -- reduction of it. A .rofl only runs against the patch it was recorded on, so
  -- `patch` is the key that finds a client capable of playing this file. Both
  -- are NULL when the header could not be read: Riot has changed that format
  -- before, and a change must cost us the patch, not the replay.
  game_version TEXT,
  patch TEXT,

  duration_seconds INTEGER,

  -- Epoch milliseconds, the same units as matches.game_creation.
  recorded_at INTEGER NOT NULL,

  -- Soft delete, because deleting our copy cannot be the end of the story: the
  -- file we copied from is still sitting in Riot's folder, and the very next
  -- folder scan would import it again. The row survives as a tombstone so the
  -- watcher knows this one was deliberately let go. Riot's original is never
  -- touched — it is not ours to delete.
  deleted_at INTEGER,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_replays_match ON replays(match_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_replays_account ON replays(account_id, recorded_at DESC);

-- League installs kept around to play old replays.
--
-- A .rofl is only playable by the patch that produced it, and Riot keeps
-- exactly one installed. Anyone who wants to watch last month's game needs that
-- month's game files, so Foxfire keeps a register of where they are. Paths
-- rather than copies: a 20 GB install is the user's to place, and most people
-- who keep old patches already have them somewhere deliberate.
--
-- The live install is never listed here. It is always available and its patch
-- is read at the moment it is needed, so registering it would only create a row
-- that goes stale every two weeks.
CREATE TABLE client_archives (
  id INTEGER PRIMARY KEY,

  -- A League of Legends install root — the directory holding Game\.
  path TEXT NOT NULL UNIQUE,

  -- major.minor, e.g. "15.14". Matching ignores the build and hotfix digits
  -- because Riot's own replay compatibility does.
  patch TEXT NOT NULL,

  -- 'detected' when read from the game executable's version resource, 'manual'
  -- when the user corrected it. Recorded so a detected value can be refreshed
  -- later without silently overwriting something typed on purpose.
  patch_source TEXT NOT NULL DEFAULT 'detected',

  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
