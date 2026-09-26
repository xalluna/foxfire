import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { AccountEmail, AccountEmailResult } from '@foxfire/core'
import { useClient } from '../client/context'
import { useConnection } from '../client/useConnection'
import { queryKeys } from './keys'

/**
 * Your own address: whether it is confirmed, and any move to a new one waiting
 * on its link.
 *
 * Asked again whenever the window comes back into focus — the link that
 * confirms an address is opened in another tab, or on a phone, and the banner
 * asking for it should go the moment it has been. Null where there is nothing
 * to say: local-only, signed out, or a server older than mail.
 */
export function useAccountEmail(): UseQueryResult<AccountEmail | null> {
  const client = useClient()
  const connection = useConnection()
  const signedIn = connection?.mode === 'server' && connection.session !== null

  return useQuery({
    queryKey: queryKeys.accountEmail(),
    queryFn: () => client.account.email(),
    enabled: signedIn,
    refetchOnWindowFocus: true,
    staleTime: 30_000
  })
}

/** What a banner or a settings card does with the answer to a resend or a cancel. */
function useAccountEmailWrite(write: () => Promise<AccountEmailResult>) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: write,
    onSuccess: (result) => {
      if (result.ok && result.email) queryClient.setQueryData(queryKeys.accountEmail(), result.email)
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.accountEmail() })
  })
}

/** Another confirmation link — for the address being moved to, or else the one you have. */
export function useResendEmailConfirmation() {
  const client = useClient()
  return useAccountEmailWrite(() => client.account.resendEmailConfirmation())
}

/** Stops a move to a new address that has not been confirmed. */
export function useCancelEmailChange() {
  const client = useClient()
  return useAccountEmailWrite(() => client.account.cancelEmailChange())
}

/**
 * Whether to ask the member to confirm their address, and what to say.
 *
 * Only on a server that sends mail, and only while the address is unconfirmed
 * or a move is waiting. Each shell draws the banner in its own way — this is
 * the part both agree on.
 */
export interface EmailNudge {
  kind: 'unconfirmed' | 'pending'
  /** The address the link went, or goes, to. */
  address: string
  /** When another link may be asked for, or null for now. */
  canResendAt: string | null
  suppressed: boolean
}

export function useEmailVerificationNudge(): EmailNudge | null {
  const { data } = useAccountEmail()
  if (!data?.mailEnabled) return null

  if (data.pendingEmail) {
    return { kind: 'pending', address: data.pendingEmail, canResendAt: data.canResendAt, suppressed: false }
  }

  if (!data.emailConfirmed) {
    return { kind: 'unconfirmed', address: data.email, canResendAt: data.canResendAt, suppressed: data.suppressed }
  }

  return null
}
