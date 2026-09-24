import clsx from 'clsx'
import { useAssetManifest } from '../context/assetManifest'
import { championIconUrl, championName } from '../lib/assets'
import { kdaRatio } from '../lib/matchStats'
import { Asset } from './Asset'

/** What a row needs of a champion's record, from a handful of recent games or a whole season. */
export interface ChampionRecord {
  championId: number
  games: number
  wins: number
  kills: number
  deaths: number
  assists: number
}

/**
 * One champion's line in a short list: who, how well, and how often.
 *
 * Shared by the recent-form block and the profile's season list so a champion
 * reads the same way in both — the two differ only in what goes under the win
 * rate. `record` is the W–L, for a window of a few games where each one is
 * visible; `games` is the count, for a season where the record would be
 * two numbers too many.
 */
export function ChampionRecordRow({
  champ,
  detail = 'record'
}: {
  champ: ChampionRecord
  detail?: 'record' | 'games'
}): JSX.Element {
  const assets = useAssetManifest()
  const winRate = champ.games > 0 ? champ.wins / champ.games : 0
  const kda = kdaRatio(champ.kills, champ.deaths, champ.assists)

  return (
    <div className="flex items-center gap-2">
      <Asset
        src={assets ? championIconUrl(assets, champ.championId) : null}
        className="h-7 w-7"
        rounded="rounded-full"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-dim">
          {assets ? championName(assets, champ.championId) : ''}
        </p>
        <p className="text-2xs tabular-nums text-text-mute">
          {kda === 'Perfect' ? 'Perfect' : `${kda}:1`} KDA
        </p>
      </div>
      <div className="text-right">
        <p
          className={clsx(
            'text-sm tabular-nums',
            winRate >= 0.6 ? 'text-teal' : winRate >= 0.5 ? 'text-text' : 'text-text-dim'
          )}
        >
          {Math.round(winRate * 100)}%
        </p>
        <p className="text-2xs tabular-nums text-text-mute">
          {detail === 'games'
            ? `${champ.games} ${champ.games === 1 ? 'game' : 'games'}`
            : `${champ.wins}W ${champ.games - champ.wins}L`}
        </p>
      </div>
    </div>
  )
}
