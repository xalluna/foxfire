import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ladderPosition } from '@shared/ladder'
import { queueFilterLabel, queueIdForQueueType } from '@shared/queues'
import type { EditableMatch, ManualRank, ManualRankEdit, QueueType } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName } from '../lib/assets'
import { formatAge, formatClock } from '../lib/matchStats'
import { Asset } from '../components/Asset'
import { EmptyState } from '../components/EmptyState'
import * as Icon from '../components/icons'
import { RankInput, RankLabel } from './RankInput'

/**
 * Reads the account and queue this window was opened for.
 *
 * Carried in the hash rather than fetched, because the window is opened from a
 * right-click on a specific row in another renderer process and there is no
 * shared store between the two — see lpEditorWindow.ts.
 */
function readContext(): { accountId: number; queueType: QueueType; matchId: string } | null {
  const raw = window.location.hash.replace(/^#lp-editor\??/, '')
  const params = new URLSearchParams(raw)
  const accountId = Number.parseInt(params.get('account') ?? '', 10)
  const queueType = params.get('queue')
  const matchId = params.get('match')

  if (Number.isNaN(accountId) || !queueType || !matchId) return null
  return { accountId, queueType: queueType as QueueType, matchId }
}

/** A draft is the after state, plus the before for the rare game that needs one. */
interface Draft {
  after: ManualRank | null
  before: ManualRank | null
}

function deltaOf(before: ManualRank | null, after: ManualRank | null): number | null {
  if (!before || !after) return null
  const from = ladderPosition(before)
  const to = ladderPosition(after)
  if (from === null || to === null) return null
  return to - from
}

/**
 * Root of the LP editor.
 *
 * Attribution can only work out what a game was worth when exactly one ranked
 * game sits between two rank readings. A run played with the client closed
 * collapses into one interval and every game in it comes out blank; this is
 * where the user says what they were.
 *
 * Entries are batched behind one Save on purpose. They interact: stating the
 * rank after two games of a run of three splits it into three single-game
 * intervals, and the third resolves on its own — so the list that comes back
 * from a save is usually shorter than the one that went in.
 */
export function LpEditorApp(): JSX.Element {
  const context = useMemo(readContext, [])
  const assets = useAssets()
  const queryClient = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [error, setError] = useState<string | null>(null)
  const [focusedMatchId, setFocusedMatchId] = useState(context?.matchId ?? null)
  const rowRefs = useRef(new Map<string, HTMLLIElement>())

  const accountId = context?.accountId ?? 0
  const queueType = context?.queueType ?? 'RANKED_SOLO_5x5'

  const editable = useQuery({
    queryKey: ['editableMatches', accountId, queueType],
    queryFn: () => window.api.rank.editable(accountId, queueType),
    enabled: context !== null
  })

  // Reopening from another row focuses the window instead of reloading it, so
  // the scroll has to be driven by a message rather than by the hash.
  useEffect(() => window.api.rank.onEditorFocus(setFocusedMatchId), [])

  useEffect(() => {
    if (!focusedMatchId || !editable.data) return
    rowRefs.current.get(focusedMatchId)?.scrollIntoView({ block: 'center' })
  }, [focusedMatchId, editable.data])

  const save = useMutation({
    mutationFn: (edits: ManualRankEdit[]) =>
      window.api.rank.saveManual(accountId, queueType, edits),
    onSuccess: (fresh: EditableMatch[]) => {
      queryClient.setQueryData(['editableMatches', accountId, queueType], fresh)
      setDrafts({})
      setError(null)
    },
    onError: (err: Error) => setError(err.message)
  })

  const matches = editable.data ?? []

  /**
   * The row's current values: what the user has typed, falling back to what is
   * already stored for it. A game whose preceding reading is unusable seeds its
   * before field from whatever it has, so opening a saved entry shows both
   * halves rather than a blank starting point.
   */
  const draftFor = (match: EditableMatch): Draft =>
    drafts[match.matchId] ?? {
      after: match.manual,
      before: match.beforeUsable ? null : match.before
    }

  /**
   * What a game actually starts from, once earlier entries are taken into
   * account.
   *
   * A stretch of games that fell between two readings all report the same
   * opening reading, because that is all the database knows. But entering the
   * rank after one of them writes a reading at that game's end, which becomes
   * what the next game in the stretch starts from — so a preview measured
   * against the opening reading would show the whole run's movement on every
   * row instead of each game's own.
   *
   * Walks only within the stretch: a different beforeAt means a real reading
   * sits in between, and that one still anchors the row.
   */
  /**
   * The game this one directly follows, or null when it opens its stretch.
   *
   * The list runs newest first, so a game's predecessor sits immediately
   * *below* it. A different beforeAt means a real reading separates the two and
   * the stretch has ended.
   */
  const predecessor = (match: EditableMatch, index: number): EditableMatch | null => {
    const earlier = matches[index + 1]
    return earlier && earlier.beforeAt === match.beforeAt ? earlier : null
  }

  /**
   * Any entry further down the stretch, which is what stops a game needing to
   * state its own starting rank.
   *
   * Skipping over blanks is right here and wrong for the preview: one entry
   * anywhere below anchors the ladder, but a delta needs the game *immediately*
   * before this one, or it measures across whatever sits between them.
   */
  const anchorBelow = (match: EditableMatch, index: number): ManualRank | null => {
    for (let i = index + 1; i < matches.length; i++) {
      if (matches[i].beforeAt !== match.beforeAt) break
      const after = draftFor(matches[i]).after
      if (after) return after
    }
    return null
  }

  const beforeFor = (match: EditableMatch, index: number): ManualRank | null => {
    const earlier = predecessor(match, index)
    if (earlier) return draftFor(earlier).after
    // Opens the stretch: the stored reading, or the one this row supplies
    // because no reading precedes it at all.
    return match.beforeUsable ? match.before : draftFor(match).before
  }

  /**
   * Only a game that opens a stretch with no readings at all has to state where
   * it started — the bottom row of such a stretch, since the list runs newest
   * first. Every game after it starts where its predecessor finished, so asking
   * again would be redundant typing and an invitation to contradict it.
   */
  const needsOwnBefore = (match: EditableMatch, index: number): boolean =>
    !match.beforeUsable && anchorBelow(match, index) === null

  /** Whether the game directly before this one is still waiting to be filled in. */
  const awaitingEarlier = (match: EditableMatch, index: number): boolean => {
    const earlier = predecessor(match, index)
    return earlier !== null && draftFor(earlier).after === null
  }

  const setDraft = (match: EditableMatch, patch: Partial<Draft>): void =>
    setDrafts((prev) => ({ ...prev, [match.matchId]: { ...draftFor(match), ...patch } }))

  /**
   * A row is submittable once it has an after state and the ladder can be
   * anchored somewhere below it.
   *
   * Deliberately weaker than having a delta to show: entering a game whose
   * immediate predecessor is still blank writes a perfectly good reading, and
   * usually resolves the game on the *other* side of it. Refusing to save it
   * because this one row's figure is unknowable would throw that away.
   */
  const isSaveable = (match: EditableMatch, index: number): boolean => {
    if (draftFor(match).after === null) return false
    if (match.beforeUsable) return true
    return anchorBelow(match, index) !== null || draftFor(match).before !== null
  }

  /** Games still lacking a figure — an entered one is listed but is not pending work. */
  const outstanding = matches.filter((match) => match.manual === null).length

  const pending: ManualRankEdit[] = matches.flatMap((match, index) => {
    if (drafts[match.matchId] === undefined || !isSaveable(match, index)) return []
    const draft = draftFor(match)
    return [
      {
        matchId: match.matchId,
        after: draft.after!,
        // Only sent when nothing usable precedes the game; otherwise the stored
        // reading is already the anchor and a second one would contradict it.
        ...(match.beforeUsable ? {} : { before: draft.before })
      }
    ]
  })

  if (!context) {
    return (
      <div className="min-h-screen bg-canvas p-8 text-text">
        <EmptyState
          icon={<Icon.Warning />}
          tone="error"
          title="No game selected"
          description="Open this window by right-clicking a match in the history list."
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-text">
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/95 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Icon.TrendingUp className="text-accent" />
          <h1 className="font-display text-base text-text">Edit LP</h1>
          <span className="rounded-full border border-hairline bg-surface px-2.5 py-0.5 text-2xs text-text-dim">
            {queueFilterLabel(queueIdForQueueType(queueType))}
          </span>
        </div>
        <p className="mt-1.5 max-w-2xl text-2xs leading-relaxed text-text-mute">
          These games have no LP figure because more than one of them fell between two rank
          readings, so the total could not be split. Enter the rank you finished a game at and the
          rest of the run is worked out from it — you rarely need to fill in every row.
        </p>
      </header>

      <main className="flex-1 p-5">
        {editable.isPending ? (
          <p className="text-2xs text-text-mute">Loading…</p>
        ) : matches.length === 0 ? (
          <EmptyState
            icon={<Icon.Check />}
            title="Nothing to fix"
            description="Every ranked game on this queue already has its LP worked out."
          />
        ) : (
          <ul className="divide-y divide-hairline/60 overflow-hidden rounded-lg border border-hairline bg-surface">
            {matches.map((match, index) => {
              const draft = draftFor(match)
              const before = beforeFor(match, index)
              // Its true starting rank is whatever the games below it finished
              // at, so until those are entered there is no delta to show. The
              // stretch's opening reading sits several games back and would
              // report the whole run's movement as this one game's.
              const pending = awaitingEarlier(match, index)
              const delta = pending ? null : deltaOf(before, draft.after)

              return (
                <li
                  key={match.matchId}
                  ref={(el) => {
                    if (el) rowRefs.current.set(match.matchId, el)
                    else rowRefs.current.delete(match.matchId)
                  }}
                  className={clsx(
                    'flex flex-wrap items-center gap-x-4 gap-y-2 border-l-[3px] px-3 py-2.5 transition',
                    match.win ? 'border-l-teal' : 'border-l-red',
                    focusedMatchId === match.matchId && 'bg-accent/[0.07]'
                  )}
                >
                  <div className="flex w-[210px] shrink-0 items-center gap-2">
                    <Asset
                      src={assets ? championIconUrl(assets, match.championId) : null}
                      className="h-8 w-8"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-2xs text-text">
                        {assets
                          ? championName(assets, match.championId, match.championName)
                          : (match.championName ?? '')}
                        <span className={clsx('ml-1.5', match.win ? 'text-teal' : 'text-red')}>
                          {match.win ? 'Win' : 'Loss'}
                        </span>
                      </p>
                      <p className="truncate text-2xs tabular-nums text-text-mute">
                        {match.kills}/{match.deaths}/{match.assists} ·{' '}
                        {formatClock(match.gameDuration)} · {formatAge(match.gameCreation)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-text-mute">From</span>
                    {needsOwnBefore(match, index) ? (
                      // No usable reading precedes this game and nothing entered
                      // above it supplies one — the first game tracked, or one
                      // straight out of placements. Attribution cannot anchor a
                      // delta without a starting point, so this row has to give
                      // one or it would save to no visible effect.
                      <RankInput
                        value={draft.before}
                        onChange={(next) => setDraft(match, { before: next })}
                      />
                    ) : pending ? (
                      <span className="text-2xs text-text-mute">after the games below</span>
                    ) : (
                      <RankLabel rank={before} />
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-text-mute">To</span>
                    <RankInput
                      value={draft.after}
                      // Seeds the selects and places a bare LP number in the
                      // right division, so most rows need only the number.
                      from={before}
                      onChange={(next) => setDraft(match, { after: next })}
                    />
                  </div>

                  {/* An entered game keeps its row so a typo can be fixed in
                      place, but it should not read as still outstanding. */}
                  {match.manual !== null && drafts[match.matchId] === undefined && (
                    <span className="text-2xs text-teal">Saved</span>
                  )}

                  <span
                    className={clsx(
                      'ml-auto w-[76px] shrink-0 text-right text-2xs font-medium tabular-nums',
                      delta === null
                        ? 'text-text-mute'
                        : delta > 0
                          ? 'text-teal'
                          : delta < 0
                            ? 'text-red'
                            : 'text-text-dim'
                    )}
                  >
                    {delta === null
                      ? '—'
                      : `${delta > 0 ? '▲' : delta < 0 ? '▼' : ''} ${Math.abs(delta)} LP`}
                  </span>

                  {/* Typed an after state with nothing to measure it against.
                      Saying so beats letting Save quietly leave the row out. */}
                  {draft.after !== null && before === null && (
                    <p className="w-full text-2xs leading-snug text-amber">
                      Enter the rank going into this game too — there is no earlier reading to
                      measure the change against.
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </main>

      {matches.length > 0 && (
        <footer className="sticky bottom-0 flex items-center gap-3 border-t border-hairline bg-canvas/95 px-5 py-3 backdrop-blur">
          <button
            onClick={() => save.mutate(pending)}
            disabled={pending.length === 0 || save.isPending}
            className="rounded-md border border-accent-dim bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
          >
            {save.isPending ? 'Saving…' : `Save ${pending.length || ''}`.trim()}
          </button>
          {pending.length > 0 && (
            <button
              onClick={() => {
                setDrafts({})
                setError(null)
              }}
              className="text-2xs text-text-mute transition hover:text-text-dim"
            >
              Discard changes
            </button>
          )}
          {error && <p className="text-2xs leading-snug text-red">{error}</p>}
          <span className="ml-auto text-2xs text-text-mute">
            {outstanding} game{outstanding === 1 ? '' : 's'} without LP
          </span>
        </footer>
      )}
    </div>
  )
}
