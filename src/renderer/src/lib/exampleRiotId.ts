/**
 * Example Riot IDs for the placeholder in any "type a summoner" field.
 *
 * A pool rather than one constant for two reasons. A shipped build should not
 * suggest the maintainer's own account — that reads as a real instruction to a
 * stranger, and quietly names someone who never asked to be in the UI. And the
 * tags are region-accurate on purpose: a user who only ever sees #NA1 tends to
 * assume that is the shape of a tag, when their duo's may well be #EUW.
 */
export const EXAMPLE_RIOT_IDS = [
  'Faker#KR1',
  'Chovy#KR1',
  'ShowMaker#KR1',
  'Ruler#KR1',
  'Doublelift#NA1',
  'Bjergsen#NA1',
  'CoreJJ#NA1',
  'Caps#EUW',
  'Rekkles#EUW',
  'Perkz#EUW',
  'Jankos#EUW',
  'Uzi#CN'
] as const

/** Uniform pick from the pool. Callers draw once per mount, not per render. */
export function randomExampleRiotId(): string {
  return EXAMPLE_RIOT_IDS[Math.floor(Math.random() * EXAMPLE_RIOT_IDS.length)]
}
