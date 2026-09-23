# Setting up YouTube uploads

Foxfire uploads to YouTube with each person's own Google sign-in, through **one Google Cloud
project that belongs to Foxfire**. This is the setup for that project, and for building an installer
that carries it. A build with YouTube switched on but made without the client — a contributor's, or
CI's — simply has no uploads, and says so in Settings › YouTube.

## Switching it on

Recordings on YouTube ship **switched off**, in the desktop, the server and the web client alike,
until the project below has been through Google's verification and YouTube's audit. Nothing about
it can be turned on by somebody holding a build: it is decided when the build is made.

1. Finish everything below — the project, the reviews, and the repository secrets.
2. In the repository's **Settings › Secrets and variables › Actions › Variables**, add
   `FOXFIRE_FEATURE_YOUTUBE` with the value `1`. Both release workflows read it: the desktop's
   installer, the server, and the web client built into the server all take the same answer.
3. Cut a server release and a desktop release — the server first, as always. A server built without
   the switch has no recording routes, and a desktop with it simply keeps its videos to attach until
   its server has them; the other way round, a server with it and a desktop without, offers nothing
   to upload with but plays whatever the web client attaches.

Taking the variable away again and releasing switches it back off. Videos already attached stay in
the database, unserved, and come back when it is next on.

For development, set the same variable in the shell before starting anything —
`$env:FOXFIRE_FEATURE_YOUTUBE='1'` in PowerShell, `export FOXFIRE_FEATURE_YOUTUBE=1` elsewhere — for
`npm run dev`, `npm run dev:web`, `npm run dev:mock -w @foxfire/web`, a packaged build, or
`dotnet test apps/server`. It is not read from `.env.local`: the build configs read it, not the app.

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
   **Desktop app**. Keep the client id, and the client secret in case it turns out to be needed.

## What is, and is not, a secret here

Nothing in the build is. The client id is in the address of every Google sign-in page, and Google
documents installed apps as unable to keep a secret: anything built into the installer can be read
back out of it. What protects a person's channel is theirs alone — the refresh token Google gives
their copy of Foxfire, encrypted on their PC — plus the PKCE verifier Foxfire makes for every
sign-in, and the fact that a Desktop client can only send a sign-in back to 127.0.0.1.

**The client secret is optional.** Google lists it as optional when a code is exchanged with PKCE,
so try a build without it first: if Connect works and an upload survives an hour (which needs a token
refresh), ship without it, and the installer carries nothing that even looks like a secret. If
Google refuses, the connect error says the build needs its secret; add it and rebuild.

Both values stay out of the repository either way, so a fork builds without borrowing this project's
quota. What does need guarding:

- **The Google account that owns the project** — two-factor on. It controls the consent screen, the
  secrets and the quota.
- **The quota.** Anyone who pulls the client id out of an installer can upload with it using their
  own Google account, and every upload counts against the project. Set a per-user limit in
  **APIs & Services › Quotas**, and watch it. If the client is abused, create a new secret (or a new
  client), ship an update with it, then disable the old one; copies that have not updated will ask
  to connect again.

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
| `MAIN_VITE_YOUTUBE_CLIENT_ID` | the client id — required for uploads at all |
| `MAIN_VITE_YOUTUBE_CLIENT_SECRET` | the client secret — optional, sent only when set |

- **Releases.** Add the id as the repository secret `YOUTUBE_OAUTH_CLIENT_ID`, and the secret as
  `YOUTUBE_OAUTH_CLIENT_SECRET` only if Google turned out to need it. `.github/workflows/release.yml`
  passes whichever exist to the installer build; one that is not set arrives empty and is left out.
- **Local development.** Put the variables in `apps/desktop/.env.local`, which git ignores.

## Checking a build

In a packaged build made with the switch on (`FOXFIRE_FEATURE_YOUTUBE=1` in the environment, then
`npm run build -w @foxfire/desktop` and `npx electron-builder --win --dir` in `apps/desktop`):

1. Settings › YouTube › **Connect YouTube** opens Google in the browser and comes back connected.
2. Upload a short recording from Captures › Recordings; quit Foxfire half way, reopen it, and the
   upload carries on from where it was.
3. Start a game (champ select is enough) and the upload pauses; it carries on when the game ends.
4. Open the uploaded recording: it plays from YouTube, the markers seek it, and the switch plays
   the file instead.
