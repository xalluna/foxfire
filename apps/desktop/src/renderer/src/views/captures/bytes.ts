/** Shared by both tabs, which report the same figure about very different files. */
export const GB = 1024 * 1024 * 1024

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '—'
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
