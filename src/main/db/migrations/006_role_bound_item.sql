-- Every participant carries a role quest reward that no item slot ever held:
-- match-v5 reports it separately as roleBoundItem, and it never appears among
-- item0-6. Bottom's reward is the player's boots, so a bot-lane row was showing
-- a finished build with no footwear in it at all.
--
-- Stored as its own column rather than an eighth entry in items_json, because
-- it is a role reward and not an inventory slot — items_json keeps meaning the
-- six bought slots plus the trinket.
--
-- The full payload has been stored since 001, so existing history backfills
-- locally with no Riot API calls and no re-sync — the same approach 002 used
-- for multi-kills and 004 for remakes.
ALTER TABLE match_participants ADD COLUMN role_bound_item INTEGER NOT NULL DEFAULT 0;

-- Correlated back by puuid rather than array position, since insertion order is
-- not guaranteed to match the payload's participant order. COALESCE covers both
-- matches predating the field and modes without lanes, which report 0.
UPDATE match_participants
   SET role_bound_item = COALESCE((
     SELECT json_extract(participant.value, '$.roleBoundItem')
       FROM matches m,
            json_each(json_extract(m.raw_json, '$.info.participants')) AS participant
      WHERE m.match_id = match_participants.match_id
        AND json_extract(participant.value, '$.puuid') = match_participants.puuid
   ), 0);
