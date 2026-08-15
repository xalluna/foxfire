-- Multi-kill was never projected into match_participants, but the full
-- match-v5 payload has been stored in matches.raw_json since 001, so existing
-- history can be backfilled locally. No Riot API calls, no re-sync.
ALTER TABLE match_participants ADD COLUMN largest_multi_kill INTEGER;

-- Correlates each stored participant row back to its entry in the raw payload
-- by puuid. json_each over $.info.participants avoids depending on array order
-- matching insertion order.
UPDATE match_participants
   SET largest_multi_kill = (
     SELECT json_extract(participant.value, '$.largestMultiKill')
       FROM matches m,
            json_each(json_extract(m.raw_json, '$.info.participants')) AS participant
      WHERE m.match_id = match_participants.match_id
        AND json_extract(participant.value, '$.puuid') = match_participants.puuid
   );

-- getMatchSummaries aggregates kills and damage per team on every page of
-- history; without this the join degrades to a scan of the whole table.
CREATE INDEX IF NOT EXISTS idx_participants_match_team
  ON match_participants(match_id, team_id);
