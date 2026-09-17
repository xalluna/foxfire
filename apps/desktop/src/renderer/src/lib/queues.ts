/** Only the queues worth naming; anything else falls back to the raw game mode. */
const QUEUE_NAMES: Record<number, string> = {
  400: 'Normal Draft',
  420: 'Ranked Solo',
  430: 'Normal Blind',
  440: 'Ranked Flex',
  450: 'ARAM',
  700: 'Clash',
  1700: 'Arena',
  1900: 'URF'
}

export function queueName(queueId: number | null, gameMode: string | null): string {
  return QUEUE_NAMES[queueId ?? -1] ?? gameMode ?? 'Game'
}
