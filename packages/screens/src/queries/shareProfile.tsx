import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Account } from '@foxfire/core'
import { absoluteUrl } from '@foxfire/core/routes'
import { ShareLinkDialog } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useConnection } from '../client/useConnection'
import { queryKeys } from './keys'

/**
 * "Share" on a profile: a link anybody can open, for a week, without an account.
 *
 * Offered only where it adds something — a member, signed in to a server that
 * is not already open to everybody, and that says where its web client lives.
 * On an open server the plain "Copy link" already reaches anyone.
 *
 * The link is made when the dialog opens rather than on a second click, since
 * opening it is the asking; the server hands back the same link for the same
 * profile within a day, so opening it twice does not make two.
 *
 * `pathFor` is the profile's address with the token on it — League's or TFT's,
 * so the link opens on the game the person was looking at.
 */
export function useShareProfile(
  account: Account,
  pathFor: (token: string) => string
): { onShare: (() => void) | undefined; dialog: JSX.Element | null } {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const connection = useConnection()
  const [open, setOpen] = useState(false)

  const create = useMutation({
    mutationFn: () => client.shares.create(account.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.shareLinks() })
  })

  const publicUrl = connection?.publicUrl ?? null
  const available =
    connection?.mode === 'server' && connection.session !== null && !connection.publicAccess && publicUrl !== null

  if (!available) return { onShare: undefined, dialog: null }

  const made = create.data
  const close = (): void => {
    setOpen(false)
    create.reset()
  }

  return {
    onShare: () => {
      setOpen(true)
      create.mutate()
    },
    dialog: open ? (
      <ShareLinkDialog
        riotId={`${account.gameName}#${account.tagLine}`}
        link={made ? { url: absoluteUrl(publicUrl, pathFor(made.token)), expiresAt: made.expiresAt } : null}
        error={create.error ? create.error.message : null}
        onCopy={(url) => platform.copyText(url)}
        onRevoke={async () => {
          if (!made) return { ok: false, error: 'There is no link to withdraw yet.' }
          const result = await client.shares.revoke(made.id)
          if (result.ok) void queryClient.invalidateQueries({ queryKey: queryKeys.admin.shareLinks() })
          return result
        }}
        onClose={close}
      />
    ) : null
  }
}
