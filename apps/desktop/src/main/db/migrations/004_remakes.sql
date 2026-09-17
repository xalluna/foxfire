-- Remakes (someone failed to connect, the game is voided a few minutes in)
-- award no LP and say nothing about how a champion performs, but they were
-- being counted in champion win rates like any other game. Three of them was
-- enough to make this app's numbers disagree with op.gg, which excludes them.
--
-- match-v5 flags them explicitly via gameEndedInEarlySurrender, and the full
-- payload has been stored since 001, so existing history backfills locally with
-- no Riot API calls and no re-sync — the same approach 002 used for multi-kills.
ALTER TABLE match_participants ADD COLUMN game_ended_in_early_surrender INTEGER NOT NULL DEFAULT 0;

-- Correlated back by puuid rather than array position, since insertion order is
-- not guaranteed to match the payload's participant order.
UPDATE match_participants
   SET game_ended_in_early_surrender = COALESCE((
     SELECT json_extract(participant.value, '$.gameEndedInEarlySurrender')
       FROM matches m,
            json_each(json_extract(m.raw_json, '$.info.participants')) AS participant
      WHERE m.match_id = match_participants.match_id
        AND json_extract(participant.value, '$.puuid') = match_participants.puuid
   ), 0);

-- Every champion-stats and LP-attribution query now filters on this, and it is
-- overwhelmingly 0, so the index keeps those from re-scanning the table.
CREATE INDEX idx_participants_remake ON match_participants(puuid, game_ended_in_early_surrender);
