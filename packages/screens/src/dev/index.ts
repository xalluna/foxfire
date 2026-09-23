/**
 * @foxfire/screens/dev — fixtures for reviewing every screen in a browser.
 *
 * Imported lazily behind import.meta.env.DEV by each app's harness, so none of
 * it reaches a production build. The desktop's own mock builds its
 * desktop-only half on top of what is here.
 */
export { createFixtureClient, runFixtureImport } from './fixtureClient'
export { KEY_EXPIRED, MOCK_SERVER_URL, delay, fail, scenario, type Scenario } from './scenario'
export { DEV_SEASONS } from './seasons'
export { createFakeYouTubeMount } from './fakeYouTube'
export { FIXTURE_VIDEO_ID, fixtureDescription, fixtureEvents, fixtureRecording } from './recordings'
export { DDRAGON_MANIFEST } from './ddragonManifest'
export {
  C,
  DAY,
  HOUR,
  ITEMS_AD,
  ITEMS_AP,
  ITEMS_SUPPORT,
  ITEMS_TANK,
  K,
  NOW,
  ROLE_ITEM,
  S,
  detailFor,
  perks,
  type Keystone
} from './catalog'
export {
  ACCOUNTS,
  LEAGUE_ENTRIES,
  MASTERY,
  MATCHES,
  MATCH_DETAILS,
  MATCH_RECORDINGS,
  RANK_SNAPSHOTS,
  championStatsFor,
  matchIdAt
} from './fixtures'
