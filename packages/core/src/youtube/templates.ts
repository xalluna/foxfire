import type { RecordingEvent } from '../types'

/**
 * What a recording is called on YouTube, and what its description says.
 *
 * Pure and here rather than beside the uploader, because two places draw the
 * same text: the upload form prefills from it, and the settings page previews a
 * title template against a real game before anybody commits to it. YouTube's
 * own limits are enforced here too — a title over 100 characters or a
 * description over 5,000 bytes is refused by the API after the whole file has
 * gone up, which is the most expensive possible moment to find out.
 */

/** YouTube's cap, in characters. */
export const TITLE_MAX_CHARS = 100

/** YouTube's cap, in UTF-8 bytes rather than characters. */
export const DESCRIPTION_MAX_BYTES = 5_000

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

/** The last line of every description Foxfire writes. */
export const DESCRIPTION_FOOTER = 'Recorded with Foxfire'

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
  URF: 'URF'
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

/** YouTube refuses both anywhere in a title or a description. */
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

  const tidy = stripAngles(filled)
    .split('·')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
    .join(' · ')

  const title = tidy === '' ? 'League of Legends recording' : tidy
  // By code point, so a title never ends in half a surrogate pair.
  return Array.from(title).slice(0, TITLE_MAX_CHARS).join('').trim()
}

/** YouTube ignores a chapter shorter than this. */
const MIN_CHAPTER_SECONDS = 10

/**
 * How far before an event its line starts.
 *
 * The same lead-in the marker strip seeks with: the useful moment is the
 * approach to a fight, and a chapter that begins on the kill shows the
 * aftermath.
 */
const CHAPTER_LEAD_IN_SECONDS = 3

const STREAKS: Record<string, string> = {
  '2': 'Double kill',
  '3': 'Triple kill',
  '4': 'Quadra kill',
  '5': 'Penta kill'
}

function describeEvent(event: RecordingEvent): string | null {
  switch (event.role) {
    case 'kill':
      return event.label ? `Killed ${event.label}` : 'Kill'
    case 'death':
      return event.label ? `Killed by ${event.label}` : 'Died'
    case 'multikill': {
      const streak = event.label ? STREAKS[event.label] : undefined
      return streak ?? (event.label ? `${event.label}x multikill` : 'Multikill')
    }
    case 'assist':
      // A description listing every assist is a wall; the marker strip has them.
      return null
  }
}

/** `4:12`, or `1:02:07` past the hour — the forms YouTube reads as timestamps. */
export function formatTimestamp(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const seconds = String(whole % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * The description: a line per kill, death and multikill, then the credit.
 *
 * Written as timestamps so YouTube turns them into chapters — the markers
 * Foxfire draws beside its own player, available to somebody watching on
 * youtube.com too. YouTube only makes chapters of a list that starts at 0:00
 * and never steps less than ten seconds, so events closer than that share a
 * line rather than producing a list YouTube would ignore wholesale.
 *
 * Over 5,000 bytes the list is cut from the end, never the credit.
 */
export function buildRecordingDescription(events: readonly RecordingEvent[]): string {
  const lines: Array<{ at: number; text: string[] }> = [{ at: 0, text: ['Start'] }]

  const described = [...events]
    .sort((a, b) => a.videoTime - b.videoTime)
    .map((event) => ({ at: Math.max(0, event.videoTime - CHAPTER_LEAD_IN_SECONDS), text: describeEvent(event) }))
    .filter((entry): entry is { at: number; text: string } => entry.text !== null)

  for (const entry of described) {
    const last = lines[lines.length - 1]!
    if (Math.floor(entry.at) - Math.floor(last.at) < MIN_CHAPTER_SECONDS) {
      last.text.push(entry.text.charAt(0).toLowerCase() + entry.text.slice(1))
    } else {
      lines.push({ at: entry.at, text: [entry.text] })
    }
  }

  const rendered = lines.map((line) => stripAngles(`${formatTimestamp(line.at)} ${line.text.join(', ')}`))
  const footer = `\n\n${DESCRIPTION_FOOTER}`

  while (rendered.length > 1 && byteLength(rendered.join('\n') + footer) > DESCRIPTION_MAX_BYTES) {
    rendered.pop()
  }

  return rendered.join('\n') + footer
}

/** Whether a description is within YouTube's limit, for the upload form's counter. */
export function descriptionBytes(text: string): number {
  return byteLength(text)
}
