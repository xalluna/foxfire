import { queueDefinition } from '../games/registry'
import { countedPlacement, ordinal } from '../rules/tft'

/**
 * What a recording is called on the server.
 *
 * Pure and here rather than beside the uploader, because two places draw the
 * same text: the upload queue names every recording it sends by it, and the
 * settings page previews a title template against a real game before anybody
 * commits to it.
 */

/** Long enough for any template's tokens, and short enough to read on one row. */
export const TITLE_MAX_CHARS = 100

/** The title a recording gets unless its owner has written their own template. */
export const DEFAULT_TITLE_TEMPLATE = '{champion} · {queue} · {result} · {kda}'

/**
 * The title for a recording that never found its match.
 *
 * With no match there is no result and no KDA, and a title reduced to the
 * champion alone would name every Practice Tool session the same, so the date
 * stands in for what is missing.
 */
export const UNMATCHED_TITLE_TEMPLATE = '{champion} · {queue} · {date}'

/** The tokens a title template may use, in the order the settings page lists them. */
export const TITLE_TOKENS = ['champion', 'queue', 'result', 'kda', 'date'] as const
export type TitleToken = (typeof TITLE_TOKENS)[number]

/** What a title can be made from. Null wherever the game did not say. */
export interface RecordingTitleFacts {
  champion: string | null
  queueId: number | null
  gameMode: string | null
  /** Null for a recording that never found its match. */
  win: boolean | null
  kills: number | null
  deaths: number | null
  assists: number | null
  /** Epoch milliseconds. */
  playedAt: number | null
}

const QUEUE_LABELS: Record<number, string> = {
  0: 'Custom',
  400: 'Normal Draft',
  420: 'Ranked Solo/Duo',
  430: 'Normal Blind',
  440: 'Ranked Flex',
  450: 'ARAM',
  490: 'Quickplay',
  700: 'Clash',
  900: 'ARURF',
  1700: 'Arena',
  1900: 'URF'
}

const MODE_LABELS: Record<string, string> = {
  CLASSIC: "Summoner's Rift",
  ARAM: 'ARAM',
  CHERRY: 'Arena',
  PRACTICETOOL: 'Practice Tool',
  TUTORIAL: 'Tutorial',
  URF: 'URF',
  TFT: 'Teamfight Tactics'
}

/**
 * A queue's name as a title reads it.
 *
 * Spelled out rather than borrowed from the match list, which says "Ranked
 * Solo" to fit a row: a video title is read by people who have never seen
 * Foxfire, and "Ranked Solo/Duo" is what the game itself calls it.
 */
export function queueLabel(queueId: number | null, gameMode: string | null): string | null {
  if (queueId !== null && QUEUE_LABELS[queueId]) return QUEUE_LABELS[queueId]!
  const known = queueDefinition(queueId)?.label
  if (known) return known
  if (gameMode) return MODE_LABELS[gameMode.toUpperCase()] ?? titleCase(gameMode)
  return null
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `23 Sep 2026`, on this machine's calendar. Written by hand so it reads the same in every locale. */
function formatDate(epochMs: number): string {
  const date = new Date(epochMs)
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

function tokenValue(token: TitleToken, facts: RecordingTitleFacts): string | null {
  switch (token) {
    case 'champion':
      return facts.champion
    case 'queue':
      return queueLabel(facts.queueId, facts.gameMode)
    case 'result':
      return facts.win === null ? null : facts.win ? 'Victory' : 'Defeat'
    case 'kda':
      return facts.kills === null || facts.deaths === null || facts.assists === null
        ? null
        : `${facts.kills}/${facts.deaths}/${facts.assists}`
    case 'date':
      return facts.playedAt === null ? null : formatDate(facts.playedAt)
  }
}

/** Kept out of titles, which are drawn in pages and logs alike. */
function stripAngles(text: string): string {
  return text.replace(/[<>]/g, '')
}

/**
 * Fills a title template in.
 *
 * A token with nothing to say takes the separator beside it with it, so an
 * unmatched recording under the default template reads `Ahri · Practice Tool`
 * rather than `Ahri · Practice Tool ·  · `. Unknown tokens are left as typed —
 * a person previewing `{champoin}` should see their typo, not have it vanish.
 */
export function renderRecordingTitle(template: string, facts: RecordingTitleFacts): string {
  const filled = template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const token = TITLE_TOKENS.find((candidate) => candidate === name.toLowerCase())
    return token ? (tokenValue(token, facts) ?? '') : whole
  })

  return finishTitle(filled, 'League of Legends recording')
}

/**
 * A filled template made tidy: separators with nothing either side
 * dropped, angle brackets stripped, and the whole held to 100 characters.
 */
function finishTitle(filled: string, fallback: string): string {
  const tidy = stripAngles(filled)
    .split('·')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
    .join(' · ')

  const title = tidy === '' ? fallback : tidy
  // By code point, so a title never ends in half a surrogate pair.
  return Array.from(title).slice(0, TITLE_MAX_CHARS).join('').trim()
}

/**
 * The title a TFT recording gets unless its owner has written their own.
 *
 * TFT has no champion and no KDA, so it has its own tokens and its own
 * template: where the board finished, in which queue, and the trait it was
 * built around — `1st · Ranked TFT · Flora Fatalis`.
 */
export const DEFAULT_TFT_TITLE_TEMPLATE = '{placement} · {queue} · {trait}'

/** A TFT recording that never found its match has no placement and no board. */
export const UNMATCHED_TFT_TITLE_TEMPLATE = '{queue} · {date}'

/** The tokens a TFT title template may use, in the order the settings page lists them. */
export const TFT_TITLE_TOKENS = ['placement', 'queue', 'trait', 'date'] as const
export type TftTitleToken = (typeof TFT_TITLE_TOKENS)[number]

/** What a TFT title can be made from. Null wherever the game did not say. */
export interface TftRecordingTitleFacts {
  queueId: number | null
  /** The player's own place, 1 to 8. Null for a recording that never found its match. */
  placement: number | null
  /** The team's place in Double Up, which is the one a title names there. */
  teamPlacement: number | null
  /** The strongest active trait, by name — already named, from the manifest or the id. */
  trait: string | null
  /** Epoch milliseconds. */
  playedAt: number | null
}

function tftTokenValue(token: TftTitleToken, facts: TftRecordingTitleFacts): string | null {
  switch (token) {
    case 'placement':
      return facts.placement === null
        ? null
        : ordinal(countedPlacement({ placement: facts.placement, teamPlacement: facts.teamPlacement }, facts.queueId))
    case 'queue':
      return queueLabel(facts.queueId, 'TFT')
    case 'trait':
      return facts.trait
    case 'date':
      return facts.playedAt === null ? null : formatDate(facts.playedAt)
  }
}

/** Fills a TFT title template in, by the same rules as renderRecordingTitle. */
export function renderTftRecordingTitle(template: string, facts: TftRecordingTitleFacts): string {
  const filled = template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const token = TFT_TITLE_TOKENS.find((candidate) => candidate === name.toLowerCase())
    return token ? (tftTokenValue(token, facts) ?? '') : whole
  })

  return finishTitle(filled, 'Teamfight Tactics recording')
}
