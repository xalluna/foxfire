import type { Account, SyncProgressEvent } from '@foxfire/core'
import { useAssetManifest } from '../context/assetManifest'
import { profileIconUrl } from '../lib/assets'
import { Asset } from './Asset'
import { CopyLinkButton } from './CopyLinkButton'
import { ProfileMarks, type FavoriteMark, type HomeMark } from './ProfileMarks'
import { SyncButton } from './SyncButton'
import { SyncProgressBar } from './SyncProgressBar'

/**
 * The horizontal form of the identity card, used below 1280px.
 *
 * The two-column layout needs roughly 1272px before the match row starts
 * clipping its item slots, and the window can be resized down to 1024. Rather
 * than degrade the row, the rail folds away and gives the full width back to
 * the match list: this strip says who, and the rail's rank and champion cards
 * sit beneath it at full size — which is why it carries no rank of its own.
 * "Sync now" is anybody's here too, and waits out the cooldown the same way;
 * see ProfileHeader.
 */
export function ProfileStrip({
  account,
  onRefresh,
  refreshing,
  cooldownUntil,
  progress,
  onCopyLink,
  favorite,
  home
}: {
  account: Account
  onRefresh: () => void
  refreshing: boolean
  /** When the server takes a sync of this account again. Null when nothing holds it back. */
  cooldownUntil: string | null
  /** The latest sync event for this account, if one is running or has just failed. */
  progress?: SyncProgressEvent
  /** Copies a link to this profile. Absent where there is no web client to link into. */
  onCopyLink?: () => Promise<void> | void
  /** The star. Absent where nobody can be starred. */
  favorite?: FavoriteMark
  /** The house, for opening on this account. */
  home?: HomeMark
}): JSX.Element {
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
          <SyncButton
            onSync={onRefresh}
            syncing={refreshing}
            cooldownUntil={cooldownUntil}
            className="shrink-0"
          />
        </div>
      </div>

      <SyncProgressBar progress={progress} />
    </section>
  )
}
