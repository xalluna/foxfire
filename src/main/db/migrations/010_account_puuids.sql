-- Riot encrypts a puuid against the API key that asked for it, so replacing the
-- key — a personal key expiring, or an application key finally being approved —
-- invalidates every puuid this app has ever stored. Riot answers a stale one
-- with 400 "Exception decrypting", and the sync stops dead.
--
-- The recovery is to re-resolve each account from its Riot ID, which is the one
-- handle that survives a key change, and rewrite the local history onto the new
-- puuid. This table is what that rewrite leaves behind: the identities an
-- account used to have.
--
-- It is a record, not a lookup. Nothing joins through it, because the rekey
-- rewrites match_participants and matches.raw_json in the same transaction and
-- leaves no stale value behind to resolve. It exists so a puuid that turns up
-- later — in a log, in a backup, in a bug report — can be attributed to the
-- account it belonged to, and so "why did this row change" has an answer.
CREATE TABLE account_puuids (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  puuid TEXT NOT NULL,
  retired_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, puuid)
);
