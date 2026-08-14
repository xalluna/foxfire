import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName, profileIconUrl } from '../lib/assets'

function parseRiotId(raw: string): { gameName: string; tagLine: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const idx = trimmed.lastIndexOf('#')
  if (idx === -1) return { gameName: trimmed, tagLine: 'NA1' }
  const gameName = trimmed.slice(0, idx).trim()
  const tagLine = trimmed.slice(idx + 1).trim()
  if (!gameName || !tagLine) return null
  return { gameName, tagLine }
}

export function Search(): JSX.Element {
  const assets = useAssets()
  const [value, setValue] = useState('')

  const search = useMutation({
    mutationFn: (raw: string) => {
      const parsed = parseRiotId(raw)
      if (!parsed) throw new Error('Enter a Riot ID like Alluna#NA1')
      return window.api.search.summoner(parsed)
    }
  })

  const result = search.data

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">Look up a summoner</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          One-off lookup — fetched live and not saved. Add an account instead to keep full history.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          search.mutate(value)
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Summoner#NA1"
          spellCheck={false}
          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-slate-500"
        />
        <button
          type="submit"
          disabled={!value.trim() || search.isPending}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
        >
          {search.isPending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {search.isError && (
        <p className="rounded-md border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {search.error instanceof Error && search.error.message.includes('404')
            ? 'No summoner found with that Riot ID.'
            : search.error instanceof Error
              ? search.error.message
              : 'Search failed'}
        </p>
      )}

      {result && assets && (
        <>
          <section className="flex items-center gap-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5">
            {(() => {
              const icon = profileIconUrl(assets, result.profile.profileIconId)
              return icon ? (
                <img src={icon} alt="" className="h-14 w-14 rounded-lg border border-slate-700" />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-slate-800" />
              )
            })()}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold">
                {result.profile.gameName}
                <span className="text-slate-500">#{result.profile.tagLine}</span>
              </h2>
              <p className="text-xs text-slate-500">Level {result.profile.summonerLevel}</p>
            </div>
            <div className="flex gap-4">
              {result.leagueEntries.length === 0 && (
                <span className="text-xs text-slate-500">Unranked</span>
              )}
              {result.leagueEntries.map((entry) => (
                <div key={entry.queueType} className="text-right text-xs">
                  <p className="text-slate-500">
                    {entry.queueType === 'RANKED_SOLO_5x5' ? 'Solo/Duo' : 'Flex'}
                  </p>
                  <p className="text-slate-200">
                    {entry.tier} {entry.rank} · {entry.leaguePoints} LP
                  </p>
                  <p className="text-slate-500">
                    {entry.wins}W {entry.losses}L
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40">
            <p className="border-b border-slate-800 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Last {result.recentMatches.length} games
            </p>
            <ul className="divide-y divide-slate-800/70">
              {result.recentMatches.map((match) => {
                const icon = championIconUrl(assets, match.championId)
                return (
                  <li
                    key={match.matchId}
                    className={`flex items-center gap-3 px-4 py-2.5 ${
                      match.win ? 'border-l-2 border-l-sky-500' : 'border-l-2 border-l-rose-500'
                    }`}
                  >
                    {icon ? (
                      <img src={icon} alt="" className="h-9 w-9 rounded" />
                    ) : (
                      <div className="h-9 w-9 rounded bg-slate-800" />
                    )}
                    <span className="w-28 truncate text-sm text-slate-200">
                      {championName(assets, match.championId, match.championName)}
                    </span>
                    <span className="w-20 tabular-nums text-sm text-slate-300">
                      {match.kills}/{match.deaths}/{match.assists}
                    </span>
                    <span
                      className={`w-12 text-sm ${match.win ? 'text-sky-400' : 'text-rose-400'}`}
                    >
                      {match.win ? 'Win' : 'Loss'}
                    </span>
                    <span className="ml-auto text-[11px] text-slate-500">
                      {formatDistanceToNow(new Date(match.gameCreation), { addSuffix: true })}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
