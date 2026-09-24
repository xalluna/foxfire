import type { Account, SyncProgressEvent } from '@foxfire/core'
import { useAssetManifest } from '../context/assetManifest'
import { profileIconUrl } from '../lib/assets'
import { Asset } from './Asset'
import { CopyLinkButton } from './CopyLinkButton'
import { ProfileMarks, type FavoriteMark, type HomeMark } from './ProfileMarks'
import { SyncProgressBar } from './SyncProgressBar'
import * as Icon from './icons'

/**
 * The top of the profile's rail: who this account is, and the buttons that act
 * on it. The rank and champion cards beneath it are DashboardPage's, because
 * below 1280px they leave the rail for the main column and this does not.
 *
 * Nothing on the rail offers a period picker. The tier, LP and record on the
 * rank cards are Riot's current reading, the graph is the last thirty days and
 * the champions are the current season, each labelled as such; every other
 * window is one "More" away.
 */
/**
 * Why syncing somebody else's account is not offered.
 *
 * A sync spends the community's shared Riot budget on history that is not
 * yours to fetch, and the server refuses it with not_your_account — so the
 * button could only ever produce a 403 with nothing to act on. Undefined is
 * local-only, where every account in the file is yours.
 */
const NOT_YOURS = 'Only whoever claimed this account can sync it'

export function ProfileHeader({
  account,
  onRefresh,
  refreshing,
  progress,
  onCopyLink,
  favorite,
  home
}: {
  account: Account
  onRefresh: () => void
  refreshing: boolean
  /** The latest sync event for this account, if one is running or has just failed. */
  progress?: SyncProgressEvent
  /** Copies a link to this profile. Absent where there is no web client to link into. */
  onCopyLink?: () => Promise<void> | void
  /** The star. Absent where nobody can be starred. */
  favorite?: FavoriteMark
  /** The house, for opening on this account. */
  home?: HomeMark
}): JSX.Element {
  const notYours = account.isMine === false
  const assets = useAssetManifest()

  return (
    <section className="rounded-lg border border-hairline bg-surface p-4">
      <div className="flex flex-col items-center text-center">
        <div className="relative">
          <Asset
            src={assets ? profileIconUrl(assets, account.profileIconId) : null}
            className="h-20 w-20 border-2 border-accent-dim"
            rounded="rounded-lg"
          />
          {account.summonerLevel !== null && (
            <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded-full border border-accent-dim bg-canvas px-2 py-0.5 text-2xs font-medium tabular-nums text-accent">
              {account.summonerLevel}
            </span>
          )}
        </div>

        <h1 className="mt-4 max-w-full truncate font-display text-xl text-text">
          {account.gameName}
        </h1>
        {/*
          The tag usually already names the region ("Faker#NA1" on na1), so
          appending the platform would just repeat it. Only shown when they
          genuinely differ — an EUW-tagged account playing on NA, say.
        */}
        <p className="text-sm text-text-mute">
          #{account.tagLine}
          {account.tagLine.toUpperCase() !== account.platform.toUpperCase() &&
            ` · ${account.platform.toUpperCase()}`}
        </p>

        <button
          onClick={onRefresh}
          disabled={refreshing || notYours}
          title={notYours ? NOT_YOURS : undefined}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
        >
          <Icon.Sync className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Syncing…' : 'Sync now'}
        </button>

        {(onCopyLink || favorite || home) && (
          <div className="mt-2 flex w-full justify-center gap-1.5">
            {onCopyLink && <CopyLinkButton onCopy={onCopyLink} className="flex-1 py-1.5" />}
            <ProfileMarks favorite={favorite} home={home} />
          </div>
        )}
      </div>

      <SyncProgressBar progress={progress} />
    </section>
  )
}
