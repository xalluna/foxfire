# Setting up YouTube uploads

Foxfire uploads to YouTube with each person's own Google sign-in, through **one Google Cloud
project that belongs to Foxfire**. This is the setup for that project, and for building an installer
that carries it. A build made without it — a contributor's, or CI's — simply has no YouTube uploads,
and says so in Settings › YouTube.

## The project

1. Create a project at <https://console.cloud.google.com/>.
2. **APIs & Services › Library**: enable **YouTube Data API v3**.
3. **APIs & Services › OAuth consent screen**:
   - User type **External**.
   - App name **Foxfire**, a support email, and the homepage
     `https://github.com/xalluna/foxfire`.
   - Privacy policy: `https://github.com/xalluna/foxfire/blob/main/apps/desktop/docs/PRIVACY.md`.
   - Scopes: `openid`, `.../auth/userinfo.email` and `.../auth/youtube.upload`.
4. **APIs & Services › Credentials › Create credentials › OAuth client ID**, application type
   **Desktop app**. Keep the client id and the client secret.

Google documents a Desktop client's secret as not confidential — it ships inside every installer —
and what protects a sign-in is the PKCE verifier Foxfire makes for it. It is kept out of the
repository anyway, so a fork builds without borrowing this project's quota.

## Before anybody else can watch

Two reviews stand between the project and a working feature, and both take time. Start them early.

- **Consent screen verification.** While the consent screen is in **Testing**, only the (at most
  100) test users you list can connect, and Google expires their sign-in after **7 days** — every
  week they have to connect again. `youtube.upload` is a sensitive scope, so publishing the app to
  **In production** needs Google's verification: the privacy policy above, a video of the consent
  flow, and a written justification for the scope.
- **The YouTube API compliance audit.** Every video uploaded through the API by a project that has
  not passed the audit is **forced private**, whatever the uploader chose — so nobody else on a
  Foxfire Server can watch it. Foxfire notices and says so on the recording. Apply with the
  [YouTube API Services audit form](https://support.google.com/youtube/contact/yt_api_form); the
  audit is also where the upload quota is raised.

Until the audit passes, "Attach a YouTube link" still works: a video uploaded by hand on youtube.com
as unlisted plays for everybody.

## Quota

Uploads draw on the project's **Video Uploads** quota — 100 uploads a day by default, **shared by
every install built with this client**. When it runs out, Foxfire's queue waits until the quota
resets at midnight Pacific time and carries on. Watch it in **APIs & Services › Quotas**, and ask for
more through the audit form above.

## Building with it

The desktop reads the client at build time from two environment variables, which electron-vite
bakes into the main process:

| Variable | Value |
|---|---|
| `MAIN_VITE_YOUTUBE_CLIENT_ID` | the client id |
| `MAIN_VITE_YOUTUBE_CLIENT_SECRET` | the client secret |

- **Releases.** Add them as the repository secrets `YOUTUBE_OAUTH_CLIENT_ID` and
  `YOUTUBE_OAUTH_CLIENT_SECRET`. `.github/workflows/release.yml` passes them to the installer build.
- **Local development.** Put the two variables in `apps/desktop/.env.local`, which git ignores.

## Checking a build

In a packaged build (`npm run build -w @foxfire/desktop`, then `npx electron-builder --win --dir` in
`apps/desktop`):

1. Settings › YouTube › **Connect YouTube** opens Google in the browser and comes back connected.
2. Upload a short recording from Captures › Recordings; quit Foxfire half way, reopen it, and the
   upload carries on from where it was.
3. Start a game (champ select is enough) and the upload pauses; it carries on when the game ends.
4. Open the uploaded recording: it plays from YouTube, the markers seek it, and the switch plays
   the file instead.
