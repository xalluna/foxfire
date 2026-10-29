import { useState } from 'react'
import clsx from 'clsx'

/**
 * An image with a themed placeholder, replacing the img-plus-fallback-div
 * pattern that was duplicated across five components.
 *
 * There are two distinct ways an asset can be absent and both must degrade to
 * the same box: the Data Dragon manifest hasn't loaded yet (so the URL builder
 * returned null), or the CDN request failed (so onError fires). The manifest
 * arrives over IPC while images load from the CDN directly, so the two are
 * genuinely independent.
 *
 * `alt` is empty by default, for art beside a name that already says it. An
 * icon that is the only place something is named — an item, a spell, a rune —
 * passes its name, and the placeholder carries it too, so a failed image does
 * not take the name with it.
 */
export function Asset({
  src,
  alt = '',
  className,
  rounded = 'rounded',
  title
}: {
  src: string | null | undefined
  alt?: string
  /** Sizing utilities, applied to both the image and the placeholder so they occupy identical space. */
  className?: string
  rounded?: string
  title?: string
}): JSX.Element {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return (
      <div
        className={clsx('shrink-0 bg-surface-2', rounded, className)}
        title={title}
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
      />
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      title={title}
      loading="lazy"
      onError={() => setFailed(true)}
      className={clsx('shrink-0 object-cover', rounded, className)}
    />
  )
}
