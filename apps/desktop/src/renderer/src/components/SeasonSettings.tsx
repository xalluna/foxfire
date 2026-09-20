import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Season, SeasonInput } from '@shared/types'
import { SettingsCard } from './settings/SettingsCard'
import { SettingsBlock } from './settings/SettingsRow'
import { checkboxClass, ghostButtonClass, inputClass, primaryButtonClass } from './settings/controls'
import * as Icon from './icons'

/**
 * The ranked season boundaries, entered by hand.
 *
 * Riot publishes no way to ask when a season started — the static season list
 * stopped at 2019, ranked entries carry no season field, and match-v5 dropped
 * the seasonId that match-v4 used to send. Deriving one from the calendar was
 * tried and is wrong: 2026 opened on 8 January, and a preseason can run into
 * February, so a hard 1 January cut misfiles games every year with nothing the
 * user can do about it.
 *
 * Editing is draft-then-save rather than save-per-keystroke. A half-typed date
 * is still a real instant, and applying it would re-file every stored game the
 * moment it happened to parse. That is also why this keeps an explicit Save
 * where the rest of Settings applies immediately.
 */

/** Epoch ms to the `YYYY-MM-DDTHH:mm` an `input[type=datetime-local]` wants, in local time. */
function toLocalInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The inverse. NaN for a partial value, which validation catches before saving. */
function fromLocalInput(value: string): number {
  return new Date(value).getTime()
}

type Draft = SeasonInput & { key: string }

let nextKey = 0

const toDraft = (season: SeasonInput): Draft => ({ ...season, key: `row-${nextKey++}` })

/**
 * What is wrong with the list, or null.
 *
 * Ordering is deliberately not checked: rows are stored and read back sorted by
 * start, so entering them out of order is harmless rather than an error worth
 * blocking a save over.
 */
function problemWith(rows: Draft[]): string | null {
  if (rows.length === 0) return 'Keep at least one season — every game has to belong to one.'
  if (rows.some((r) => r.label.trim() === '')) return 'Every season needs a name.'
  if (rows.some((r) => !Number.isFinite(r.startsAt))) return 'Every season needs a start date.'

  const starts = rows.map((r) => r.startsAt)
  if (new Set(starts).size !== starts.length) {
    return 'Two seasons cannot start at the same moment.'
  }
  return null
}

const sameAsSaved = (rows: Draft[], saved: Season[]): boolean =>
  rows.length === saved.length &&
  rows.every((r, i) => {
    const s = saved[i]
    return (
      r.id === s.id &&
      r.label === s.label &&
      r.startsAt === s.startsAt &&
      r.isPreseason === s.isPreseason &&
      r.resetsRank === s.resetsRank
    )
  })

export function SeasonsCard(): JSX.Element {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<Draft[] | null>(null)

  const seasons = useQuery({ queryKey: ['seasons'], queryFn: () => window.api.seasons.list() })

  // Seeded once from the server, then owned locally until saved.
  useEffect(() => {
    if (seasons.data && rows === null) setRows(seasons.data.map(toDraft))
  }, [seasons.data, rows])

  const save = useMutation({
    mutationFn: (next: SeasonInput[]) => window.api.seasons.save(next),
    onSuccess: (saved) => {
      queryClient.setQueryData(['seasons'], saved)
      setRows(saved.map(toDraft))
      // Every picker, every scoped aggregate and every LP chip is derived from
      // these dates, so all of it is stale the moment they change.
      queryClient.invalidateQueries({ queryKey: ['rankPeriods'] })
      queryClient.invalidateQueries({ queryKey: ['rankHistory'] })
      queryClient.invalidateQueries({ queryKey: ['championStats'] })
      queryClient.invalidateQueries({ queryKey: ['matchList'] })
    }
  })

  const draft = rows ?? []
  const problem = problemWith(draft)
  const unchanged = seasons.data ? sameAsSaved(draft, seasons.data) : true

  const patch = (key: string, change: Partial<SeasonInput>): void =>
    setRows((current) => (current ?? []).map((r) => (r.key === key ? { ...r, ...change } : r)))

  const addSeason = (): void =>
    setRows((current) => [
      ...(current ?? []),
      toDraft({
        label: `Season ${new Date().getFullYear() + 1}`,
        // Next January at noon: a plausible default that is nearly always
        // wrong by a few days, which is exactly the thing being edited.
        startsAt: new Date(new Date().getFullYear() + 1, 0, 1, 12).getTime(),
        isPreseason: false,
        resetsRank: true
      })
    ])

  return (
    <SettingsCard
      title="Ranked seasons"
      description="Riot offers no way to ask when a season started, so the dates live here. Each season runs until the next one begins and the newest never ends, so nothing breaks if you add January late — add the next one once Riot announces the date."
    >
      {draft.map((row) => (
        <SettingsBlock key={row.key}>
          <div className="flex gap-2">
            <input
              value={row.label}
              onChange={(e) => patch(row.key, { label: e.target.value })}
              placeholder="Season 2027"
              spellCheck={false}
              aria-label="Season name"
              className={clsx(inputClass, 'flex-1')}
            />
            <input
              type="datetime-local"
              value={Number.isFinite(row.startsAt) ? toLocalInput(row.startsAt) : ''}
              onChange={(e) => patch(row.key, { startsAt: fromLocalInput(e.target.value) })}
              aria-label="Season start"
              className={clsx(inputClass, 'shrink-0 tabular-nums')}
            />
            <button
              onClick={() => setRows((c) => (c ?? []).filter((r) => r.key !== row.key))}
              aria-label="Remove season"
              className="shrink-0 rounded-md border border-hairline px-2 text-text-mute transition hover:border-red/40 hover:text-red"
            >
              <Icon.Trash width={14} height={14} />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
            <label className="flex items-center gap-2 text-2xs text-text-dim">
              <input
                type="checkbox"
                checked={row.resetsRank}
                onChange={(e) => patch(row.key, { resetsRank: e.target.checked })}
                className={checkboxClass}
              />
              Rank was reset
            </label>
            <label className="flex items-center gap-2 text-2xs text-text-dim">
              <input
                type="checkbox"
                checked={row.isPreseason}
                onChange={(e) => patch(row.key, { isPreseason: e.target.checked })}
                className={checkboxClass}
              />
              Preseason
            </label>
          </div>
        </SettingsBlock>
      ))}

      {/*
        The reset flag is the only control here that changes numbers rather than
        labels, so it is the only one that gets an explanation.
      */}
      <SettingsBlock>
        <p className="text-2xs leading-relaxed text-text-mute">
          Tick <span className="text-text-dim">Rank was reset</span> when the ladder was emptied and
          you played placements. It stops the reset being recorded as a game that cost you two
          thousand LP, and keeps it out of your promotion history. Leave it clear for a season your
          rank carried straight into, which is usually what a preseason is.
        </p>
      </SettingsBlock>

      <SettingsBlock>
        <div className="flex items-center gap-2">
          <button onClick={addSeason} className={clsx(ghostButtonClass, 'flex items-center gap-1.5')}>
            <Icon.Plus width={12} height={12} />
            Add season
          </button>

          <button
            onClick={() => save.mutate(draft.map(({ key: _key, ...season }) => season))}
            disabled={problem !== null || unchanged || save.isPending}
            className={clsx(primaryButtonClass, 'ml-auto')}
          >
            {save.isPending ? 'Saving…' : 'Save seasons'}
          </button>
        </div>

        {problem && !unchanged && <p className="mt-3 text-sm text-red">{problem}</p>}
        {save.isError && <p className="mt-3 text-sm text-red">Could not save the seasons.</p>}
      </SettingsBlock>
    </SettingsCard>
  )
}
