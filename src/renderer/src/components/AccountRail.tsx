import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Account } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { useLcuStatus } from '../hooks/useLcuStatus'
import { profileIconUrl } from '../lib/assets'
import { Asset } from './Asset'
import { AddAccountForm } from './AddAccountForm'
import * as Icon from './icons'
import { useUiStore } from '../store/uiStore'

/**
 * The account switcher.
 *
 * Collapsed it is a 64px strip of avatars; hovering slides it out to 224px to
 * reveal names and the per-account actions. The expanding element is
 * absolutely positioned inside a fixed-width shell, so opening it draws over
 * the content rather than reflowing the two columns beside it — a layout shift
 * on hover would be intolerable over a list of match rows.
 */
export function AccountRail({ accounts }: { accounts: Account[] }): JSX.Element {
  const assets = useAssets()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)

  const activeAccountId = useUiStore((s) => s.activeAccountId)
  const setActiveAccount = useUiStore((s) => s.setActiveAccount)

  const lcuStatus = useLcuStatus()
  const liveAccountId = lcuStatus.state === 'connected' ? lcuStatus.accountId : null

  const setHome = useMutation({
    mutationFn: (id: number) => window.api.accounts.setHome(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts'] })
  })

  const remove = useMutation({
    mutationFn: (id: number) => window.api.accounts.remove(id),
    onSuccess: (remaining) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setActiveAccount(remaining.length > 0 ? remaining[0].id : null)
    }
  })

  return (
    <div className="relative w-rail shrink-0">
      <div
        onMouseLeave={() => setAdding(false)}
        className={clsx(
          'group absolute inset-y-0 left-0 z-30 flex flex-col border-r border-hairline bg-canvas',
          'transition-[width] duration-150 ease-out hover:w-rail-open hover:shadow-flyout',
          adding ? 'w-rail-open shadow-flyout' : 'w-rail'
        )}
      >
        <p className="overflow-hidden whitespace-nowrap px-4 pb-1.5 pt-3 text-2xs font-medium uppercase tracking-widest text-text-mute opacity-0 transition-opacity group-hover:opacity-100">
          Accounts
        </p>

        <ul className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden px-2">
          {accounts.map((account) => {
            const isActive = account.id === activeAccountId
            return (
              <li key={account.id} className="relative">
                <button
                  onClick={() => setActiveAccount(account.id)}
                  title={`${account.gameName}#${account.tagLine}`}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition',
                    isActive ? 'bg-gold/10' : 'hover:bg-surface'
                  )}
                >
                  {/* Presence, in the Slack/Discord position: a dot on the
                      avatar marks the account currently signed into the League
                      client, which is the one whose per-game LP is being
                      captured. Absent on every other account, so an empty
                      corner means "not this one" rather than "unknown". */}
                  <span className="relative shrink-0">
                    <Asset
                      src={assets ? profileIconUrl(assets, account.profileIconId) : null}
                      className={clsx(
                        'h-9 w-9 border',
                        isActive ? 'border-gold' : 'border-hairline'
                      )}
                      rounded="rounded-md"
                    />
                    {liveAccountId === account.id && (
                      <span
                        title="Signed into the League client — capturing LP"
                        // Ringed in the rail's own background so the dot reads
                        // as an overlay rather than part of the artwork.
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-teal ring-2 ring-canvas"
                      />
                    )}
                  </span>

                  {/* Revealed by the rail expanding; kept mounted so the row keeps its height. */}
                  <span className="min-w-0 flex-1 overflow-hidden opacity-0 transition-opacity group-hover:opacity-100">
                    <span
                      className={clsx(
                        'block truncate text-sm',
                        isActive ? 'text-text' : 'text-text-dim'
                      )}
                    >
                      {account.gameName}
                    </span>
                    <span className="block truncate text-2xs text-text-mute">
                      #{account.tagLine}
                      {account.isHomeAccount && ' · home'}
                    </span>
                  </span>
                </button>

                <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 gap-0.5 group-hover:flex">
                  {!account.isHomeAccount && (
                    <button
                      title="Set as home account"
                      onClick={() => setHome.mutate(account.id)}
                      className="rounded p-1 text-text-mute transition hover:bg-surface-2 hover:text-gold"
                    >
                      <Icon.Star width={13} height={13} />
                    </button>
                  )}
                  <button
                    title="Remove account"
                    onClick={() => {
                      if (confirm(`Remove ${account.gameName}#${account.tagLine}?`)) {
                        remove.mutate(account.id)
                      }
                    }}
                    className="rounded p-1 text-text-mute transition hover:bg-surface-2 hover:text-red"
                  >
                    <Icon.Close width={13} height={13} />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="border-t border-hairline p-2">
          {adding ? (
            <div className="w-[204px]">
              <AddAccountForm onAdded={() => setAdding(false)} />
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              title="Add account"
              className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-text-dim transition hover:bg-surface hover:text-gold"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-dashed border-gold-dim">
                <Icon.Plus />
              </span>
              <span className="whitespace-nowrap text-sm opacity-0 transition-opacity group-hover:opacity-100">
                Add account
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
