interface Perks {
  styles?: Array<{ selections?: Array<{ perk: number }>; style: number }>
}

/**
 * Keystone is the first selection of the primary tree; the secondary tree is
 * shown as its style icon rather than an individual rune.
 *
 * `perks` crosses IPC as `unknown` — it is stored as opaque JSON — so the
 * shape is narrowed here rather than trusted.
 */
export function runeIds(perks: unknown): { keystone: number | null; secondary: number | null } {
  const p = perks as Perks | null
  return {
    keystone: p?.styles?.[0]?.selections?.[0]?.perk ?? null,
    secondary: p?.styles?.[1]?.style ?? null
  }
}
