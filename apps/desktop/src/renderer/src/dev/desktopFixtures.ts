import type {
  ClientArchive,
  Recording,
  RecordingEvent,
  Replay,
  RoflSettings,
  Scoreboard
} from '@shared/types'
import {
  C,
  ITEMS_AD,
  ITEMS_AP,
  ITEMS_SUPPORT,
  ITEMS_TANK,
  K,
  NOW,
  ROLE_ITEM,
  S,
  matchIdAt
} from '@foxfire/screens/dev'

/**
 * Fixtures only the desktop draws: a live game on this machine, recordings, Riot
 * replays on this disk, and archived League installs. The League data they
 * point at is the shared set in @foxfire/screens/dev.
 */

/**
 * A board mid-game, already in lane order the way the mapper hands it over.
 *
 * Covers the states the row has to survive: the tracked account (slot 4), a
 * player who is dead and counting down (slot 3), a bot (slot 9), and a champion
 * the manifest has never heard of (slot 8), which is what a brand-new release
 * looks like on the day it ships.
 */
export const SCOREBOARD: Scoreboard = {
  gameMode: 'CLASSIC',
  mapName: 'Map11',
  gameTime: 847.5,
  players: [
    { slot: 1, gameName: 'Runnit Downy Jr', tagLine: 'NA1', isSelf: false, isBot: false, isDead: false, respawnTimer: 0, level: 11, position: 'TOP', teamId: 100, championId: C.Sett, championName: 'Sett', spell1Id: S.Flash, spell2Id: S.Teleport, keystoneId: K.Conqueror[0], secondaryTreeId: K.Conqueror[1], items: ITEMS_TANK, roleBoundItem: ROLE_ITEM.TOP, kills: 3, deaths: 2, assists: 4, creepScore: 121, wardScore: 9.4 },
    { slot: 2, gameName: 'phantomduval', tagLine: 'NA1', isSelf: false, isBot: false, isDead: false, respawnTimer: 0, level: 10, position: 'JUNGLE', teamId: 100, championId: C.Vi, championName: 'Vi', spell1Id: S.Smite, spell2Id: S.Flash, keystoneId: K.Electrocute[0], secondaryTreeId: K.Electrocute[1], items: ITEMS_AD, roleBoundItem: ROLE_ITEM.JUNGLE, kills: 5, deaths: 4, assists: 8, creepScore: 96, wardScore: 14.2 },
    { slot: 0, gameName: 'Faker', tagLine: 'NA1', isSelf: true, isBot: false, isDead: false, respawnTimer: 0, level: 12, position: 'MIDDLE', teamId: 100, championId: C.Viktor, championName: 'Viktor', spell1Id: S.Teleport, spell2Id: S.Flash, keystoneId: K.ArcaneComet[0], secondaryTreeId: K.ArcaneComet[1], items: ITEMS_AP, roleBoundItem: ROLE_ITEM.MIDDLE, kills: 7, deaths: 1, assists: 5, creepScore: 154, wardScore: 11.8 },
    { slot: 3, gameName: 'Killua', tagLine: 'NA1', isSelf: false, isBot: false, isDead: true, respawnTimer: 18.4, level: 11, position: 'BOTTOM', teamId: 100, championId: C.Kaisa, championName: "Kai'Sa", spell1Id: S.Flash, spell2Id: S.Heal, keystoneId: K.PressTheAttack[0], secondaryTreeId: K.PressTheAttack[1], items: ITEMS_AD, roleBoundItem: ROLE_ITEM.BOTTOM, kills: 4, deaths: 6, assists: 3, creepScore: 143, wardScore: 8.1 },
    { slot: 4, gameName: 'ward andersen', tagLine: 'NA1', isSelf: false, isBot: false, isDead: false, respawnTimer: 0, level: 9, position: 'UTILITY', teamId: 100, championId: C.Thresh, championName: 'Thresh', spell1Id: S.Flash, spell2Id: S.Ignite, keystoneId: K.Grasp[0], secondaryTreeId: K.Grasp[1], items: ITEMS_SUPPORT, roleBoundItem: ROLE_ITEM.UTILITY, kills: 1, deaths: 5, assists: 12, creepScore: 24, wardScore: 41.6 },
    { slot: 5, gameName: 'cpdd Ontario', tagLine: 'NA1', isSelf: false, isBot: false, isDead: false, respawnTimer: 0, level: 12, position: 'TOP', teamId: 200, championId: C.Aatrox, championName: 'Aatrox', spell1Id: S.Teleport, spell2Id: S.Flash, keystoneId: K.Conqueror[0], secondaryTreeId: K.Conqueror[1], items: ITEMS_TANK, roleBoundItem: ROLE_ITEM.TOP, kills: 6, deaths: 3, assists: 2, creepScore: 138, wardScore: 7.2 },
    { slot: 6, gameName: 'jg TTVritchhi', tagLine: 'NA1', isSelf: false, isBot: false, isDead: false, respawnTimer: 0, level: 10, position: 'JUNGLE', teamId: 200, championId: C.LeeSin, championName: 'Lee Sin', spell1Id: S.Smite, spell2Id: S.Flash, keystoneId: K.LethalTempo[0], secondaryTreeId: K.LethalTempo[1], items: ITEMS_AD, roleBoundItem: ROLE_ITEM.JUNGLE, kills: 2, deaths: 5, assists: 9, creepScore: 88, wardScore: 12.9 },
    { slot: 7, gameName: 'StayyKawaii', tagLine: 'NA1', isSelf: false, isBot: false, isDead: false, respawnTimer: 0, level: 11, position: 'MIDDLE', teamId: 200, championId: C.Ahri, championName: 'Ahri', spell1Id: S.Flash, spell2Id: S.Ignite, keystoneId: K.Electrocute[0], secondaryTreeId: K.Electrocute[1], items: ITEMS_AP, roleBoundItem: ROLE_ITEM.MIDDLE, kills: 5, deaths: 4, assists: 6, creepScore: 147, wardScore: 10.5 },
    { slot: 8, gameName: 'Harrowhold', tagLine: 'NA1', isSelf: false, isBot: false, isDead: false, respawnTimer: 0, level: 11, position: 'BOTTOM', teamId: 200, championId: null, championName: 'Someone New', spell1Id: S.Flash, spell2Id: S.Heal, keystoneId: K.FirstStrike[0], secondaryTreeId: K.FirstStrike[1], items: ITEMS_AD, roleBoundItem: ROLE_ITEM.BOTTOM, kills: 8, deaths: 2, assists: 4, creepScore: 161, wardScore: 6.8 },
    { slot: 9, gameName: 'Nami Bot', tagLine: 'BOT', isSelf: false, isBot: true, isDead: false, respawnTimer: 0, level: 9, position: 'UTILITY', teamId: 200, championId: C.Nami, championName: 'Nami', spell1Id: S.Flash, spell2Id: S.Exhaust, keystoneId: K.Grasp[0], secondaryTreeId: K.Grasp[1], items: ITEMS_SUPPORT, roleBoundItem: ROLE_ITEM.UTILITY, kills: 0, deaths: 7, assists: 10, creepScore: 18, wardScore: 33.1 }
  ]
}

/**
 * Recordings, covering the three states the Recordings view has to draw.
 *
 * A bound recording, one still hunting for its match, and one that never found a
 * game — the Practice Tool case, which is the normal reason a recording stays
 * unmatched and is exactly the row most likely to be got wrong.
 */
export const RECORDINGS: Record<string, Recording[]> = {
  1: [
    {
      id: 1,
      accountId: '1',
      matchId: matchIdAt(0),
      bindState: 'bound',
      fileBytes: 1_820_000_000,
      fileExists: true,
      queueId: 420,
      startedAt: NOW - 42 * 60_000,
      endedAt: NOW - 12 * 60_000,
      durationSeconds: 1_802,
      selfChampionId: C.Viktor,
      match: {
        matchId: matchIdAt(0),
        gameCreation: NOW - 45 * 60_000,
        gameDuration: 1_802,
        gameMode: 'CLASSIC',
        queueId: 420,
        win: true,
        championId: C.Viktor,
        championName: 'Viktor',
        kills: 11,
        deaths: 3,
        assists: 8
      }
    },
    {
      id: 2,
      accountId: '1',
      matchId: null,
      bindState: 'pending',
      fileBytes: 1_100_000_000,
      fileExists: true,
      queueId: 440,
      startedAt: NOW - 8 * 60_000,
      endedAt: NOW - 60_000,
      durationSeconds: 1_412,
      selfChampionId: C.Ahri,
      match: null
    },
    {
      id: 3,
      accountId: '1',
      matchId: null,
      bindState: 'unmatched',
      fileBytes: 260_000_000,
      // Deleted from Explorer behind the app's back, which is the state the
      // "file missing" badge and the disabled Watch button exist for.
      fileExists: false,
      queueId: 0,
      startedAt: NOW - 3 * 60 * 60_000,
      endedAt: NOW - 3 * 60 * 60_000 + 420_000,
      durationSeconds: 420,
      selfChampionId: C.LeeSin,
      match: null
    }
  ],
  2: []
}

/**
 * A timeline dense enough to exercise clustering.
 *
 * Two kills seconds apart plus the multikill they add up to land on top of each
 * other on the bar, which is the case the marker clustering exists for.
 */
export const RECORDING_EVENTS: RecordingEvent[] = [
  { eventId: 1, name: 'ChampionKill', gameTime: 214, videoTime: 174, role: 'kill', label: 'Ahri' },
  { eventId: 2, name: 'ChampionKill', gameTime: 402, videoTime: 362, role: 'death', label: 'LeeSin' },
  { eventId: 3, name: 'ChampionKill', gameTime: 640, videoTime: 600, role: 'assist', label: 'Aatrox' },
  { eventId: 4, name: 'ChampionKill', gameTime: 902, videoTime: 862, role: 'kill', label: 'Aatrox' },
  { eventId: 5, name: 'ChampionKill', gameTime: 906, videoTime: 866, role: 'kill', label: 'LeeSin' },
  { eventId: 6, name: 'Multikill', gameTime: 907, videoTime: 867, role: 'multikill', label: '2' },
  { eventId: 7, name: 'ChampionKill', gameTime: 1_240, videoTime: 1_200, role: 'death', label: 'Ahri' },
  { eventId: 8, name: 'ChampionKill', gameTime: 1_690, videoTime: 1_650, role: 'kill', label: 'Nami' }
]

/**
 * Riot replays for the browser harness.
 *
 * Three rows, chosen to cover the three states the tab has to draw: one linked
 * and playable, one linked but recorded on a patch no installed client can run,
 * and one whose match has not synced so the row must fall back to the plain
 * form with no champion and no KDA.
 */
export const MOCK_REPLAYS: Replay[] = [
  {
    id: 1,
    accountId: '1',
    matchId: 'NA1_5312345678',
    fileExists: true,
    fileBytes: 31_400_000,
    gameVersion: '16.16.804.9184',
    patch: '16.16',
    durationSeconds: 1834,
    recordedAt: Date.now() - 2 * 3_600_000,
    match: {
      matchId: 'NA1_5312345678',
      gameCreation: Date.now() - 2 * 3_600_000,
      gameDuration: 1834,
      gameMode: 'CLASSIC',
      queueId: 420,
      win: true,
      championId: 103,
      championName: 'Ahri',
      kills: 11,
      deaths: 3,
      assists: 8
    },
    blockedReason: null
  },
  {
    id: 2,
    accountId: '1',
    matchId: 'NA1_5312345600',
    fileExists: true,
    fileBytes: 29_900_000,
    gameVersion: '15.14.600.4410',
    patch: '15.14',
    durationSeconds: 1502,
    recordedAt: Date.now() - 40 * 86_400_000,
    match: {
      matchId: 'NA1_5312345600',
      gameCreation: Date.now() - 40 * 86_400_000,
      gameDuration: 1502,
      gameMode: 'CLASSIC',
      queueId: 440,
      win: false,
      championId: 64,
      championName: 'LeeSin',
      kills: 4,
      deaths: 9,
      assists: 6
    },
    blockedReason: 'Needs a League client for patch 15.14'
  },
  {
    id: 3,
    accountId: null,
    matchId: 'NA1_5312399999',
    fileExists: true,
    fileBytes: 34_700_000,
    gameVersion: '16.16.804.9184',
    patch: '16.16',
    durationSeconds: 2140,
    recordedAt: Date.now() - 20 * 60_000,
    match: null,
    blockedReason: null
  }
]

export const MOCK_ROFL_SETTINGS: RoflSettings = {
  enabled: true,
  sourceFolder: null,
  resolvedSourceFolder: 'C:\\Users\\you\\Documents\\League of Legends\\Replays',
  // False so the harness can be used to design the one warning that matters.
  autoRecordEnabled: true,
  folder: 'C:\\Users\\you\\Videos\\Foxfire\\Replays',
  softCapBytes: 5 * 1024 * 1024 * 1024
}

export const MOCK_ARCHIVES: ClientArchive[] = [
  {
    id: 1,
    path: 'D:\\League archives\\League of Legends 15.14',
    patch: '15.14',
    patchSource: 'detected',
    label: 'Archived 2026-07-02',
    pathExists: true
  },
  {
    id: 2,
    path: 'E:\\old\\lol-15-10',
    patch: '15.10',
    patchSource: 'manual',
    label: null,
    pathExists: false
  }
]
