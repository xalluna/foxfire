-- Every LP figure, worked out again under the rule that places a game by its end.
--
-- Attribution used to put a game in the interval that held its creation. A
-- reading taken while the game was being played — a sync that ran mid-game, the
-- app opening mid-game — still showed the rank the player went in with, so it
-- closed the game's interval with no result in it: the game read 0 LP, or the
-- previous game's movement, and an entry typed for it closed an interval that
-- held nothing. It now goes in the interval that holds its end.
--
-- A replay only ever upserts, so a figure the old rule proved and the new one
-- cannot would outlive the change. Nothing here is lost by clearing them:
-- match_rank is derived entirely from rank_snapshots, which this leaves alone,
-- and the launch repair that runs straight after migrations replays every
-- account with no time bound and writes them all back.

DELETE FROM match_rank;
