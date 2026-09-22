import type { RefreshLock } from '@foxfire/core/server'

/**
 * Makes refreshes take turns across every tab of this site.
 *
 * Tabs share the refresh cookie, and the server rotates it on every refresh:
 * two tabs refreshing at once would present the same cookie twice, and the
 * server reads a second presentation as a stolen copy and ends every session
 * its owner has. So a refresh holds a Web Lock that every tab of this origin
 * queues behind; the one that goes second finds the cookie the first one left.
 *
 * Where Web Locks are missing — an old browser, or a page served somewhere
 * that is not a secure context — refreshes still take turns within the tab,
 * which is the most that can be done without them.
 */
export function refreshLock(name: string, locks: LockManager | undefined = globalThis.navigator?.locks): RefreshLock {
  if (locks) {
    // The DOM typings wrap the callback's promise in another; at runtime a
    // lock resolves with what the callback resolved with.
    return { run: <T>(renew: () => Promise<T>) => locks.request(name, () => renew()) as unknown as Promise<T> }
  }

  return inTabLock()
}

/** Refreshes one at a time within this tab, in the order asked. */
export function inTabLock(): RefreshLock {
  let tail: Promise<unknown> = Promise.resolve()

  return {
    run<T>(renew: () => Promise<T>): Promise<T> {
      const next = tail.then(renew, renew)
      // The queue carries on past a failure; the caller still sees it.
      tail = next.catch(() => undefined)
      return next
    }
  }
}
