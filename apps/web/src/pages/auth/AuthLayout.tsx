import type { ReactNode } from 'react'
import { Logo } from '@foxfire/ui'
import { useServerInfo } from '../../serverInfo'

/**
 * The frame every page before signing in shares: which server this is, and a
 * card for the form.
 *
 * The server's own name, not Foxfire's, because a member arrives here from a
 * link their friend sent and the first thing to confirm is that it is the
 * right place.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer
}: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}): JSX.Element {
  const server = useServerInfo()

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4 text-text">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo width={32} height={32} className="text-accent" />
          <p className="mt-3 font-display text-lg tracking-wide text-accent">
            {server.data?.serverName ?? 'Foxfire'}
          </p>
        </div>

        <section className="rounded-lg border border-hairline bg-surface p-5">
          <h1 className="font-display text-xl text-text">{title}</h1>
          {subtitle && <div className="mt-1 text-sm leading-relaxed text-text-mute">{subtitle}</div>}
          <div className="mt-4">{children}</div>
        </section>

        {footer && <div className="mt-4 text-center text-sm text-text-mute">{footer}</div>}
      </div>
    </div>
  )
}

/** A form's one line of trouble, in the server's own words. */
export function FormError({ message }: { message: string | null }): JSX.Element | null {
  if (!message) return null
  return <p className="rounded-md border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">{message}</p>
}
