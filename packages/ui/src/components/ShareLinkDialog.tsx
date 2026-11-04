import { useState } from 'react'
import type { AdminActionResult } from '@foxfire/core'
import { CopyLinkButton } from './CopyLinkButton'
import { Dialog, DialogActions } from './Dialog'
import * as Icon from './icons'
import { ghostButtonClass } from './settings/controls'

/** A share link, as the dialog shows it. */
export interface ShareLinkView {
  url: string
  expiresAt: string
}

/**
 * A profile's link for somebody who is not a member, and how long it lasts.
 *
 * Says plainly what the link opens — this profile, read-only, for a week — and
 * what it does not, because the person sharing it is deciding something on
 * behalf of whoever's profile it is. Withdrawing it is here too: the link they
 * just made is the one they are most likely to want back.
 */
export function ShareLinkDialog({
  riotId,
  link,
  error,
  onCopy,
  onRevoke,
  onClose
}: {
  /** Whose profile, as "Name#TAG". */
  riotId: string
  /** Null while it is being made. */
  link: ShareLinkView | null
  /** Why it could not be made. */
  error: string | null
  onCopy: (url: string) => Promise<void> | void
  onRevoke: () => Promise<AdminActionResult>
  onClose: () => void
}): JSX.Element {
  const [revoking, setRevoking] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const revoke = async (): Promise<void> => {
    setRevoking(true)
    setRevokeError(null)
    try {
      const result = await onRevoke()
      if (result.ok) setRevoked(true)
      else setRevokeError(result.error)
    } finally {
      setRevoking(false)
    }
  }

  return (
    <Dialog title="Share this profile" onClose={onClose}>
      {error !== null ? (
        <p className="text-sm text-red">{error}</p>
      ) : revoked ? (
        <p className="text-sm text-text-dim">Withdrawn. The link no longer opens anything.</p>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-text-dim">
            Anyone with this link can see <span className="text-text">{riotId}</span>&rsquo;s profile without
            signing in — games, ranks and champions, League and TFT
            {link ? <>, until {new Date(link.expiresAt).toLocaleDateString()}</> : ', for a week'}. Nothing else on
            this server, and nothing they can change.
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-md border border-hairline bg-surface-2 p-2.5">
            <Icon.Link width={13} height={13} className="shrink-0 text-text-mute" />
            <code className="min-w-0 flex-1 truncate text-2xs text-text-dim" aria-label="Share link">
              {link?.url ?? 'Making a link…'}
            </code>
            {link && <CopyLinkButton onCopy={() => onCopy(link.url)} className="shrink-0" />}
          </div>

          {revokeError !== null && <p className="mt-3 text-sm text-red">{revokeError}</p>}
        </>
      )}

      <DialogActions>
        {link && !revoked && error === null && (
          <button type="button" className={ghostButtonClass} disabled={revoking} onClick={() => void revoke()}>
            {revoking ? 'Withdrawing…' : 'Withdraw link'}
          </button>
        )}
        <button type="button" className={ghostButtonClass} onClick={onClose}>
          Done
        </button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * "Share", in Copy link's place, for a link that reaches somebody outside as
 * well as members. Where it is offered, a plain link would only reach members.
 */
export function ShareProfileButton({
  onShare,
  className
}: {
  onShare: () => void
  className?: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onShare}
      title="A link anyone can open, without signing in, for a week"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-edge px-2.5 py-1 text-xs text-text-dim transition hover:border-accent-dim hover:text-accent ${className ?? ''}`}
    >
      <Icon.Link width={13} height={13} />
      Share
    </button>
  )
}
