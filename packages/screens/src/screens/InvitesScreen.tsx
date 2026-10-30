import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminActionResult } from '@foxfire/core'
import { absoluteUrl, paths } from '@foxfire/core/routes'
import { InvitesPage, SignupChoiceNotice } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { useConnection } from '../client/useConnection'
import { useAccountEmail } from '../queries/accountEmail'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems } from '../queries/paging'
import { useSignupChoice } from '../queries/signupChoice'

/** Used invites per page. */
const PAGE_SIZE = 50

/** How somebody gets an account on the server you administer, and how somebody without one looks in. */
export function InvitesScreen(): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const publicUrl = useConnection()?.publicUrl ?? null

  // The open ones whole — they expire, so there are never many — and the used
  // ones, which are everybody who ever joined this way, a page at a time.
  const outstanding = useQuery({
    queryKey: queryKeys.admin.openInvites(),
    queryFn: () => client.admin.openInvites()
  })

  const used = useInfiniteQuery({
    queryKey: queryKeys.admin.usedInvites(),
    queryFn: ({ pageParam }) => client.admin.usedInvites({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: nextOffset
  })

  const settings = useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: () => client.admin.getSettings()
  })

  // Any member may share, so how many are open grows with the community.
  const shareLinks = useInfiniteQuery({
    queryKey: queryKeys.admin.shareLinks(),
    queryFn: ({ pageParam }) => client.admin.shareLinks({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: nextOffset
  })

  // Whether the server sends mail is on every member's own address answer.
  const mail = useAccountEmail()

  // The same settings read as above, so asking costs nothing.
  const signup = useSignupChoice()

  /** Under one key, because taking an invite adds a member and spends the invite. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all() })
  }

  const thenRefresh = async <T,>(run: Promise<T>): Promise<T> => {
    try {
      return await run
    } finally {
      refresh()
    }
  }

  return (
    <InvitesPage
      notice={signup.unchosen ? <SignupChoiceNotice onChoose={signup.choose} /> : undefined}
      outstanding={outstanding.data ?? []}
      used={pageItems(used.data, (invite) => invite.id)}
      invitesLoading={outstanding.isPending || used.isPending}
      hasMoreUsed={used.hasNextPage}
      loadingMoreUsed={used.isFetchingNextPage}
      onShowMoreUsed={() => void used.fetchNextPage()}
      publicSignup={settings.data?.publicSignup ?? true}
      settingsLoading={settings.isPending}
      onSetPublicSignup={async (on) => {
        await thenRefresh(client.admin.setSettings({ publicSignup: on }))
      }}
      onCreateInvite={(email) => thenRefresh(client.admin.createInvite(email))}
      onRevokeInvite={(id): Promise<AdminActionResult> => thenRefresh(client.admin.revokeInvite(id))}
      onCopy={(text) => void platform.copyText(text)}
      mailEnabled={mail.data?.mailEnabled ?? false}
      onEmailInvite={(id) => thenRefresh(client.admin.emailInvite(id))}
      publicAccess={settings.data?.publicAccess}
      onSetPublicAccess={async (on) => {
        await thenRefresh(client.admin.setSettings({ publicAccess: on }))
      }}
      shareLinks={pageItems(shareLinks.data, (link) => link.id)}
      shareLinksLoading={shareLinks.isPending}
      hasMoreShareLinks={shareLinks.hasNextPage}
      loadingMoreShareLinks={shareLinks.isFetchingNextPage}
      onShowMoreShareLinks={() => void shareLinks.fetchNextPage()}
      onCopyShareLink={
        publicUrl
          ? (link) => void platform.copyText(absoluteUrl(publicUrl, paths.player(link, { share: link.token })))
          : undefined
      }
      onRevokeShareLink={(id) => thenRefresh(client.shares.revoke(id))}
    />
  )
}
