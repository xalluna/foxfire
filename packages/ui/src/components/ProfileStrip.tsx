import type { Account, SyncProgressEvent } from '@foxfire/core'
import { useAssetManifest } from '../context/assetManifest'
import { profileIconUrl } from '../lib/assets'
import { Asset } from './Asset'
import { CopyLinkButton } from './CopyLinkButton'
import { ProfileMarks, type FavoriteMark, type HomeMark } from './ProfileMarks'
import { SyncProgressBar } from './SyncProgressBar'
import * as Icon from './icons'

/**
 * The horizontal form of the identity card, used below 1280px.
 *
 * The two-column layout needs roughly 1272px before the match row starts
 * clipping its item slots, and the window can be resized down to 1024. Rather
 * than degrade the row, the rail folds away and gives the full width back to
 * the match list: this strip says who, and the rail's rank and champion cards
 * sit beneath it at full size — which is why it carries no rank of its own.
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

export function ProfileStrip({
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
    <section className="rounded-lg border border-hairline bg-surface p-3">
      <div className="flex items-center gap-3 max-md:flex-wrap">
        <div className="relative shrink-0">
          <Asset
            src={assets ? profileIconUrl(assets, account.profileIconId) : null}
            className="h-12 w-12 border border-accent-dim"
            rounded="rounded-md"
          />
          {account.summonerLevel !== null && (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border border-accent-dim bg-canvas px-1.5 text-[9px] font-medium tabular-nums text-accent">
              {account.summonerLevel}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <h1 className="truncate font-display text-lg leading-tight text-text">
            {account.gameName}
          </h1>
          <p className="text-2xs text-text-mute">
            #{account.tagLine}
            {account.tagLine.toUpperCase() !== account.platform.toUpperCase() &&
              ` · ${account.platform.toUpperCase()}`}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ProfileMarks favorite={favorite} home={home} />
          {onCopyLink && <CopyLinkButton onCopy={onCopyLink} className="py-1.5" />}
          <button
            onClick={onRefresh}
            disabled={refreshing || notYours}
            title={notYours ? NOT_YOURS : undefined}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
          >
            <Icon.Sync className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>

      <SyncProgressBar progress={progress} />
    </section>
  )
}
