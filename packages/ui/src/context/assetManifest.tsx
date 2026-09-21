import { createContext, useContext, type ReactNode } from 'react'
import type { AssetManifest } from '@foxfire/core'

/**
 * The current patch's champion, spell and rune lookups, for anything that
 * draws an icon.
 *
 * A context rather than a prop because almost everything in a match row wants
 * it and nothing should have to thread it through three layers to get there.
 * This package only reads it: whoever mounts the screens fetches the manifest
 * and provides it, and until they have, it is null and icons draw their
 * placeholders.
 */
const AssetManifestContext = createContext<AssetManifest | null>(null)

export function AssetManifestProvider({
  manifest,
  children
}: {
  manifest: AssetManifest | null | undefined
  children: ReactNode
}): JSX.Element {
  return (
    <AssetManifestContext.Provider value={manifest ?? null}>{children}</AssetManifestContext.Provider>
  )
}

/** The manifest, or null while it is still loading. */
export function useAssetManifest(): AssetManifest | null {
  return useContext(AssetManifestContext)
}
