/**
 * Riot's required legal notice.
 *
 * Lives on Settings rather than as a footer on every screen — the notice has
 * to be present in the app, not repeated on each view, and at 800px tall the
 * reclaimed height is worth roughly another match row everywhere else.
 */
export function Disclaimer(): JSX.Element {
  return (
    <p className="text-sm leading-relaxed text-text-mute">
      This app isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of
      Riot Games or anyone officially involved in producing or managing League of Legends. League of
      Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
    </p>
  )
}
