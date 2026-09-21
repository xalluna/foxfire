import { useCaptureStatus } from './CaptureIndicator'
import { useLcuStatus } from '../hooks/useLcuStatus'
import { Icon } from '@foxfire/ui'

/**
 * The Live game tab's mark, coloured by what is actually happening.
 *
 * Three states, read at a glance from the nav without opening anything:
 *
 * - Nothing on — inherits the tab's own colour, so it is ordinary chrome.
 * - A game in progress — teal throughout.
 * - Recording that game — teal ring, red dot. The ring still says "a game is
 *   on" and the dot says "and it is being kept", which is the same convention
 *   a record light has used for sixty years.
 *
 * The two facts come from different places on purpose: whether a game is on is
 * the League client's business, and whether it is being recorded is OBS's. A
 * game plays perfectly well with capture switched off, and the ring should say
 * so.
 *
 * The taskbar button says the same thing to anyone who has tabbed away — see
 * src/main/appIconState.ts, which reads the same two statuses and adds a fourth
 * state this icon has no room for: a game that was meant to be recorded and is
 * not. Keep the two in step.
 */
export function LiveNavIcon(): JSX.Element {
  const lcu = useLcuStatus()
  const capture = useCaptureStatus()

  const inGame = lcu.state === 'connected' && lcu.inGame
  const recording = capture?.state === 'recording'

  if (!inGame) return <Icon.Live />

  return <Icon.Live className="text-teal" dotClassName={recording ? 'text-red' : undefined} />
}
