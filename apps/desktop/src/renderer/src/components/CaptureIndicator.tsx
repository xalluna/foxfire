import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Icon } from '@foxfire/ui'
import type { CaptureStatus } from '@shared/types'

/**
 * Whether capture is actually rolling, in the title bar.
 *
 * The failure this exists for is silent: OBS closed, or the password changed,
 * or the scene got renamed — and the first you would know is going looking for
 * the recording of a game you wanted to keep and finding nothing. A pill that is
 * visible while you are queueing costs a glance and makes that discoverable
 * beforehand.
 *
 * Hidden entirely when capture is off, so it is not chrome for people who never
 * turned the feature on.
 */
export function useCaptureStatus(): CaptureStatus | undefined {
  const [pushed, setPushed] = useState<CaptureStatus | null>(null)

  const polled = useQuery({
    queryKey: ['captureStatus'],
    queryFn: () => window.api.capture.getStatus(),
    // The push below carries every change; this is the initial read and a
    // backstop for a window that opened after the last one fired.
    staleTime: 30_000
  })

  useEffect(() => window.api.capture.onStatus(setPushed), [])

  return pushed ?? polled.data
}

export function CaptureIndicator(): JSX.Element | null {
  const status = useCaptureStatus()
  if (!status || status.state === 'off') return null

  const { label, tone, dot } = describe(status)

  return (
    <span
      title={label}
      className={clsx(
        'no-drag flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs',
        tone
      )}
    >
      {dot}
      {label}
    </span>
  )
}

function describe(status: CaptureStatus): {
  label: string
  tone: string
  dot: JSX.Element | null
} {
  switch (status.state) {
    case 'recording':
      return {
        label: 'Recording',
        tone: 'border-red/30 bg-red/10 text-red',
        // Pulsed, because the difference between "recording" and "about to
        // record" is the whole reason to look at this.
        dot: <Icon.Record width={9} height={9} className="animate-pulse" />
      }
    case 'armed':
      return {
        label: 'Waiting for the game',
        tone: 'border-amber/30 bg-amber/10 text-amber',
        dot: null
      }
    case 'idle':
      return { label: 'Capture ready', tone: 'border-teal/30 bg-teal/10 text-teal', dot: null }
    case 'connecting':
      return { label: 'Connecting to OBS', tone: 'border-hairline text-text-mute', dot: null }
    default:
      return {
        label: 'Capture problem',
        tone: 'border-amber/30 bg-amber/10 text-amber',
        dot: <Icon.Warning width={10} height={10} />
      }
  }
}

/**
 * The same state, stated at length for the Live Game screen.
 *
 * Mid-game is the moment it matters most and the moment the title bar is behind
 * a fullscreen League, so it is worth repeating here where somebody alt-tabbing
 * to check the scoreboard will see it.
 */
export function CaptureBanner(): JSX.Element | null {
  const status = useCaptureStatus()
  if (!status || status.state === 'off' || status.state === 'idle') return null

  if (status.state === 'recording') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
        <Icon.Record width={11} height={11} className="animate-pulse" />
        This game is being recorded.
      </div>
    )
  }

  if (status.state === 'armed') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
        <Icon.Film width={13} height={13} />
        Waiting for the game to finish loading before recording starts.
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-amber">
      <Icon.Warning width={13} height={13} />
      {status.state === 'error' ? status.message : 'Connecting to OBS…'}
    </div>
  )
}
