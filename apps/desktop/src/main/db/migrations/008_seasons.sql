-- Ranked seasons, managed by hand.
--
-- Riot publishes no way to ask which season is current. The static season list
-- stopped at 2019, ranked entries carry no season field, and match-v5 dropped
-- the seasonId that match-v4 used to send. Deriving the boundary from the
-- calendar was tried first and is simply wrong: 2026 opened on 8 January, and a
-- preseason can run into February. A hard 1 January cut would misfile every
-- game either side of it, every year, with no way to correct it.
--
-- So the boundaries live here and are edited in Settings.
--
-- A season runs from its own start until the next one starts. The newest row is
-- open-ended forwards, which is what stops a missing boundary from cutting the
-- current season short, and the oldest is open-ended backwards so no game can
-- fall outside every season. Gaps and overlaps are therefore impossible to
-- express, and there is nothing to validate beyond the ordering.

CREATE TABLE seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,

  -- Epoch milliseconds, the same units as matches.game_creation and
  -- rank_snapshots.captured_at, so scoping a query to a season needs no
  -- conversion and no SQL date function. UNIQUE because two seasons opening at
  -- the same instant has no meaning and would make the ordering ambiguous.
  starts_at INTEGER NOT NULL UNIQUE,

  -- Labelled distinctly in the pickers. A preseason still catches games: rank
  -- carries into it, so those games belong to a period like any other rather
  -- than vanishing from every view.
  is_preseason INTEGER NOT NULL DEFAULT 0,

  -- Whether the ladder actually reset when this season opened.
  --
  -- This, rather than the season boundary itself, is what stops a reset being
  -- attributed to whichever game happens to sit beside it as a two-thousand
  -- point loss. The two are not the same: a season that carries rank forward
  -- must keep attributing LP across its own start, and Riot has reset mid-year
  -- before now — the Apex tiers at patch 26.9 — which only a per-boundary flag
  -- can express.
  resets_rank INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_seasons_starts_at ON seasons(starts_at);

-- The one boundary that could actually be verified: Riot opened the 2026 ranked
-- year on 8 January 2026.
--
-- Stored as UTC midnight because a migration cannot know the machine's
-- timezone. That is a few hours either side of local midnight, and ranked
-- queues are closed across a changeover, so nothing can be misfiled by it.
-- Settings can correct it. Nothing older is seeded: no other date could be
-- confirmed, and the oldest season reaching backwards forever means earlier
-- history still has somewhere to live.
INSERT INTO seasons (label, starts_at, is_preseason, resets_rank)
VALUES ('Season 2026', 1767830400000, 0, 1);
