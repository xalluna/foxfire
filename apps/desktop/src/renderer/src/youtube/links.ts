/**
 * The pages a YouTube upload has to point at.
 *
 * YouTube's rules for an app that uploads: say that using it means agreeing to
 * YouTube's terms, link Google's privacy policy and the app's own, and show
 * where the grant can be taken back. Kept together so every place that asks
 * for a connection says the same four things.
 */
export const YOUTUBE_LINKS = {
  terms: 'https://www.youtube.com/t/terms',
  googlePrivacy: 'https://policies.google.com/privacy',
  foxfirePrivacy: 'https://github.com/xalluna/foxfire/blob/main/apps/desktop/docs/PRIVACY.md',
  revoke: 'https://myaccount.google.com/permissions'
} as const
