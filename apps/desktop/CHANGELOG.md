# Changelog

Patch notes for Foxfire, newest first. Releases before 0.8.0 shipped under the name LoL
Stats, and their entries are left as they were written.

Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with an extra **Under the hood** group for
changes you would never notice while using the app.

## [0.14.0] — 2026-09-23

Foxfire updates itself, search looks through the people your server tracks rather than strangers on
Riot, and you can look after your own account without leaving the app. A new version now arrives
quietly in the background and waits for you to restart — never in the middle of a game — and the
patch notes travel with it. Your recordings can go to YouTube, where everybody on your server can
watch them from your match history, markers and all. Needs Foxfire Server 0.3.0.

### Added

- **Updates install themselves.** Foxfire looks for a new version shortly after it starts and a few
  times a day after that, downloads it in the background, and then offers to restart. The offer
  appears across the top of the window and in the tray menu, so it reaches you whether or not the
  window is open. If you never take it, the update installs the next time you quit Foxfire.
- **Nothing is installed in the middle of a game.** While a game is on, or while a game is being
  recorded, the restart is refused and says which of the two it is waiting for — a restart then
  would cost the LP reading or the recording that Foxfire was left running for.
- **What's new, in the app.** Settings › About now has an Updates section: which version this is,
  what the updater is doing, a button to check now, and the patch notes for the version arriving.
  After an update lands, a line across the top of the window offers the same notes once.
- **Change your email, password or name** from Settings › Server, where your account already was.
  Changing your email or your password asks for your current password; changing your password signs
  out every other device and keeps this one, so a password that had got out is worth nothing
  anywhere.
- **Confirm password when making an account.** Two boxes rather than one, because a password nobody
  can read is a password nobody can check — and a typo used to mean a sign-in that could never work.
- **Reset links, for whoever administers a server.** Settings › Members now offers a reset link for
  any member: copy it, send it however your community talks, and they set a new password in a
  browser. It lasts a day, works once, and making a new one withdraws the last. Nothing about their
  account changes until they use it.
- **Members, Invites and League accounts are separate pages** in Settings, where Server management
  used to be one. Members filters by name or address and opens a line for the detail and the
  actions; Invites keeps public sign-up beside the invites it governs; League accounts is where an
  admin starts tracking somebody and where a claim is taken back.
- **The sign-in form says what to do about a forgotten password**: ask whoever runs the server for a
  reset link.
- **Recordings on YouTube.** Connect your YouTube channel in Settings › YouTube, and any recording can
  go up from the Recordings tab, from the recording itself, or from its game's right-click menu. You
  choose the title, description and who can watch; the description lists your kills and deaths as
  timestamps, which YouTube turns into chapters. Uploads run in the background one at a time, pause
  while you are in a game — from champ select until it is over — and pick up where they left off
  after a restart.
- **Upload every game automatically**, if you turn it on. Each recording goes up once it has found
  its game, with the title and privacy you set in Settings.
- **Everybody on your server can watch.** A recording on YouTube is attached to your game on your
  Foxfire Server, and "Watch recording" plays it from your match history — for you, for your friends,
  and in a browser. It is your view of the game and nobody else's: in a game two of you recorded,
  your history plays yours and theirs plays theirs.
- **Watch your friends' recordings** from their history, with their kill and death markers, in a
  window of its own.
- **Attach a YouTube link** to a recording you uploaded yourself. From the recording on your PC the
  markers go with it, so the video has to be the same file, uncut.
- **A recording on YouTube plays from YouTube**, with a switch back to the file while it is still on
  your PC — the file is the one with thumbnails on the seek bar and slow motion.

### Changed

- **Deleting a recording that is on YouTube frees the disk and keeps the recording.** The file goes;
  the recording stays, plays from YouTube and keeps its markers. **Forget** takes it off your PC
  altogether. Neither touches YouTube or your server.

- **Connected to a server, Foxfire installs the version that server accepts** rather than the
  newest one that exists. A server only talks to the builds it knows, so updating past it would
  lock you out of your own community; this way an update can only ever move you to a build that
  still works there. Local-only, it takes the newest version there is.
- **A server that refuses this build now says what is being done about it.** The message named the
  version to install and sent you to the releases page; it now tells you that version is already
  downloading, and offers the restart when it is ready.
- **Search finds the players on your server.** Typing a name turns up the accounts your server keeps
  history for, and opening one is the ordinary profile: every game, what each was worth in LP, the
  rows that open for the scoreboard, and a replay to download where the server holds one. It used to
  look up any Riot ID in the world and show ten games with no LP on them at all — nothing about a
  stranger is stored, so there was never any to show. Searching costs no Riot requests now, so it is
  as fast as the rest of the app and never queues behind a sync.
- **Anybody can refresh any account.** Asking the server to fetch what it does not have used to be
  the owner's alone. Accounts an admin tracks belong to nobody, so nobody would ever have refreshed
  them; now any member can, and an account that was refreshed in the last two minutes is left alone
  so a busy evening cannot spend the server's Riot budget twice over.
- **Needs Foxfire Server 0.3.0.** Search asks the server a different question, and everything above
  that touches your account is the server's to answer, so this version and older servers cannot talk
  to each other. A server that has not been updated says so, and its host needs to update it.
- **This is the last version you install by hand.** Foxfire Server 0.3.0 will not answer 0.12.0 or
  0.13.0 at all — search changed shape underneath them — and neither of those builds has an updater
  to carry itself across. Install this one yourself; after it, updates arrive on their own.

### Fixed

- **Connected to a server, a recording finds its game as soon as the server has it.** It used to wait
  until the next time Foxfire started.
- **"Start with Windows" no longer opens a window you did not ask for.** It always said it launches
  hidden in the tray, and on Windows it never did — every sign-in put the window on screen. It now
  starts in the tray, and an update started from the tray comes back to the tray rather than
  reopening the window in front of whatever you were doing.

### Under the hood

- Updates are read from this repository's own GitHub Releases: `latest.yml` beside the installer it
  describes, which the release workflow has been attaching since 0.12.0 in anticipation of this.
  Only the changed parts of an installer are downloaded where possible.
- Which version to fetch is settled before anything is downloaded — the active server's
  `recommendedDesktop` when there is one, the newest desktop release otherwise — and never a
  version older than the one running.
- Desktop releases now carry the Latest badge on the releases page, and server releases no longer
  take it: the desktop installer is what somebody arriving at that page is looking for, and it is
  where the updater reads the newest version from.
- The version's changelog section is built into `latest.yml` by the release workflow, which is how
  the notes reach the app at all.
- The Members and Invites screens are shared with the web client, as Server management was.
- The rule that a password is at least twelve characters lives in one place now, rather than in the
  desktop's form, the web client's, and the server.
- The Search page and the web client's Players page are one screen now, mounted under the name that
  fits each app. Its query lives in the address, so a filtered list can be linked to.
- Local-only mode searches its own database rather than Riot, the same as everywhere else, and the
  ad-hoc lookup service is gone.
- Database migration 014: the YouTube copy on each recording, whether its file was deleted on
  purpose, the upload queue, and which servers have been told about each video.
- Uploads use YouTube's resumable protocol in 8 MiB chunks and save their place after every one. The
  daily quota is waited out until midnight Pacific time; other failures back off from thirty seconds
  to an hour.
- The Google sign-in is the installed-app flow — the system browser, a one-request server on
  127.0.0.1, and PKCE — asking only to upload and for the account's email. The refresh token is
  encrypted with the other secrets.
- YouTube's player runs in a page on a scheme of its own, `foxfire-youtube://`, with no preload, so
  Google's script never shares a window with the bridge to the main process. The two talk over
  postMessage, and that page's requests carry `https://com.brandonbarr.foxfire/` as their Referer,
  which is how YouTube identifies a desktop app.
- Both privileged schemes are registered in the one call Electron allows.
- The Google client is built into release installers from repository secrets. A build without them
  has no uploads and says so. See `apps/desktop/docs/YOUTUBE_SETUP.md`.
- The recording player, its timeline and its markers are shared with the web client now.
- A privacy policy for the YouTube connection, in `apps/desktop/docs/PRIVACY.md`.

## [0.13.0] — 2026-09-21

Foxfire Server 0.2.0 hosts a web client of its own, so the people on your server can read everybody's
history in a browser. This release is the desktop's half of that: links into it, and talking to the
server where it now keeps its API.

### Added

- **Copy link.** Connected to a server, a match's menu, a profile and the rank graph each offer
  "Copy link" — a link into your server's web client, which anybody on the server can open in a
  browser once they have signed in. It opens on what you were looking at: the same game, or the same
  profile or graph with the same queue and period. Only offered where there is somewhere for it to
  go, so never in local-only mode, and not from a server too old to host a web client.

### Changed

- **Needs Foxfire Server 0.2.0.** The server moved its API under `/api` to share its address with
  the web client, and this version talks to it there. A server that has not been updated refuses
  this version — and Foxfire now says so the right way round: that the server is older than this
  copy and its host should update it, rather than telling you to install the older Foxfire the
  server names.
- **The League-client line on the Rank page opens Rank tracking**, as its tooltip always said,
  instead of the Riot API key page.

### Fixed

- **Signed in to a server, Foxfire hears it change as soon as it starts.** Sync progress, games
  arriving and LP typed in on another machine reached a copy started in server mode only after you
  signed in again or switched servers, so until then the screens sat still.
- **Several screens loading at once no longer sign you out of a server.** When your session renewed
  just as more than one screen asked for data, each of them spent the same renewal, and the server
  read the second as a stolen copy and signed you out everywhere. Renewals now take turns.
- **"View match history" in a recording's window works from anywhere.** It did nothing unless that
  account's profile happened to be the page open in the main window; now it opens it, with the game
  expanded.
- **A server's search results no longer look like games you recorded.** Every row drew the
  "something to watch" marker.
- **An empty match history no longer offers "Sync now" on somebody else's account**, where the
  server could only refuse it.

### Under the hood

- **The screens are shared with the web client.** The components, the pages built from them and the
  data layer behind them moved into packages that the desktop and the web client both build from —
  `@foxfire/ui` and `@foxfire/screens` — and what the two have to agree on, from the data shapes and
  the LP arithmetic to the server client and the stats.db import, into `@foxfire/core`. Every screen
  draws as it did.
- **Navigation is by route.** Every page has an address, and so does every other window — telemetry,
  the archive manager, a recording, the LP editor — each opened at its own. The player pages are the
  same routes the web client mounts. Queue filters still last for the session, page by page, and still
  reset on every launch.
- **The app's package is `@foxfire/desktop`.** Its name, where its settings live and everything else a
  user could see are unchanged.
- Tests at the seams: the search params each page keeps and the memory behind the queue filters, the
  links the desktop writes as the web client reads them, the match menu on each platform, what each
  server event refreshes, and the addresses the main process opens windows at.

## [0.12.0] — 2026-09-17

Foxfire can now read from a server your community hosts, instead of only from this PC. This release
is the connection itself — joining a server, and saying which League accounts are yours. Match
history still comes from your own machine; moving that across is the next piece of work.

Nothing changes if you do not want a server. Local-only stays exactly as it was, and it is what
Foxfire does until you point it somewhere.

### Added

- **A Server page in Settings.** Type the address whoever runs it gave you, and Foxfire asks the
  server what it is before anything else happens — its name, its version, and whether anyone can
  make an account there or you need an invite. Only then does it show you a form, because the
  answer decides which form to show.
- **Invites that work the way a link should.** Paste the code you were sent or the whole link;
  either is fine. Foxfire checks it with the server and fills in the email address it was sent to,
  so you cannot accidentally register with the wrong one and be turned away without being told why.
  A link can be opened as many times as you like and makes exactly one account.
- **Your community's match history, on every screen.** Connected to a server, the dashboard, the
  match list, a single game, champion stats, mastery, the rank graph and search all read from it
  instead of from this PC — and you can read everybody else's as well as your own, because that is
  what a shared server is for. Editing is still yours alone: LP you type by hand goes on an account
  you have claimed, and nothing else.
- **The server does the fetching, and tells you as it goes.** Play a game and it notices, waits for
  Riot to publish the match, and fills it in; a first backfill of a few hundred games reports its
  progress the same way it always has. Nothing on this PC needs a Riot API key any more — the
  server has one, shared by everybody on it.
- **A game ten of you played is fetched once.** Which is most of the point: the second person on a
  server to have played a match already has it, so a friend joining costs almost nothing out of the
  key everybody shares.
- **Riot replays, shared with the server.** When Foxfire picks up a .rofl it offers it to the
  server, and when somebody else has already uploaded one the match row says so and offers to
  download it. A downloaded replay is an ordinary replay: it lists, it plays through the League
  client the same way, and removing it works like any other. The menu names the patch it needs,
  because a .rofl only runs on the build that produced it.
- **Nothing waits on any of that.** A replay you just recorded is listed and playable the moment it
  lands, whether or not the server is reachable — sharing it is the extra, not the point.
- **Bringing your existing Foxfire onto a server.** If you administer one, Settings now has a Data
  & storage page that reads a `stats.db` and pushes everything in it up: accounts, match history,
  rank readings and season boundaries. Recordings and Riot replays stay on the PC they are on,
  because that is where the files are. The old file is opened read-only and never modified, and
  running the import twice is safe — nothing is imported over itself.
- **A replay storage cap, in gigabytes, on the same page.** Leave it blank for no cap, which is
  the default; set one and uploads stop once replays reach it, with everything already uploaded
  still working.
- **What the server is holding, on the same page.** Replays and how much space they take, matches
  and the player rows behind them, rank readings, and how many League accounts are still unclaimed
  — plus the shared replay library itself, biggest first, with a way to remove one. Biggest first
  because the reason to open that list is that space is needed. Anybody who played a game can
  upload its replay again afterwards, which is what makes removing one recoverable.
- **Imported accounts arrive unclaimed.** The file says which League accounts its owner played; it
  does not say who on the server they are, and that is something the League client attests to
  rather than something an import can assert. The history is there either way, and claiming an
  account is the ordinary link. Anything Riot no longer recognises — almost always a rename — is
  named at the end rather than counted, because the fix is to link it under the name it plays
  under now.
- **Switching between a server and this PC without signing out.** Coming back does not mean typing
  a password again.
- **Being told when a server is too new for this copy.** A server states which versions of Foxfire
  it serves, and one that will not serve yours says which version to install rather than failing
  with something you cannot act on. A server that would merely prefer a newer Foxfire still works,
  and says so quietly.
- **A management page, if you administer the server you are signed in to.** Invite people and copy
  the links, open or close public sign-up, and see who is on the server — with the League accounts
  each of them has claimed and how many machines they are signed in on. You can make somebody an
  admin, disable an account without deleting anything, or remove one. The page only appears when
  the server says you are an admin, and it is not where the Riot API key lives: that and the
  database are set in the server's own configuration and need a restart.

### Changed

- **Live game no longer shows each player's rank.** The scoreboard itself is free — it is read from
  the game running on this PC, not from Riot — but the rank column was two Riot requests per
  player, twenty every time the tab was opened. That is a fifth of what a personal key allows in
  two minutes, spent on a number that without op.gg's scale of history behind it was never worth
  it. Everything else on that screen is unchanged, and it now costs nothing and needs no API key.

### Under the hood

- The repository is a monorepo. The desktop app lives in `apps/desktop` and the Foxfire Server in
  `apps/server`; each has its own version, its own changelog and its own release tag.
- Server credentials are held the way the Riot API key already was — encrypted with Windows DPAPI,
  outside the database file, so `stats.db` stays something you can copy or attach to a bug report
  without handing over a login. The short-lived half of the session is never written to disk at all.
- The renderer still has no network access and never sees a token. It goes on calling the same
  `window.api` it always has; the main process decides where the answers come from.
- Events reaching the UI now go through one place instead of ten, which is what will let them
  arrive from a server rather than only from this process.
- **An account id is opaque now.** It used to be a row number in this PC's database, which is fine
  until the accounts live somewhere else and are identified by something entirely different. The
  app passes the id around without looking inside it, so the same screens work whichever store
  answered.
- **One contract, two implementations.** Everything the screens read goes through a single typed
  interface with a local half and a server half, chosen per call rather than per launch — so
  connecting or disconnecting changes what the next screen reads, not what the next launch does.
  The renderer is unchanged and still has no idea which answered.
- **The League client watcher reports rather than writes.** It still reads loopback, still decides
  when a post-game reading has settled, and still knows when a game ended; connected to a server
  it posts those facts instead of storing them. The retry ladder that waits for Riot to publish a
  match moved to the server with them, which is what lets it keep running after you close the
  laptop, and stops two people who were in the same game from both walking it.
- **A live connection to the server.** Sync progress, LP edits and rank changes arrive over it on
  the same channels the app already used for its own events, so nothing above the transport knows
  which one delivered them. LP somebody types in one window reaches every other window, on their
  machine and on yours.
- **Settings stops offering the Riot API key page on a server.** This PC holds no key then — the
  server has one, shared by everybody on it — so a page that saved one would be saving something
  nothing reads. It comes back the moment you go local-only.
- **Adding an account on a server tells you how instead of failing.** There is no Riot ID box,
  because a typed name proves nothing: sign in to the account in the League client with Foxfire
  running and it offers the link, which is what stops anybody else claiming an account that is
  yours.
- **The banner about an expired Riot key now says whose key it is.** Connected to a server this PC
  holds no key at all, so the one that offers to take you to the field would be offering something
  that does not exist. A server whose key has expired says so plainly instead, and says that
  everything already stored still works — which it does; what stops is anything new arriving.
- **Your recordings and replays stop pointing into tables that are about to leave.** They are files
  on this disk and stay here, so their link to an account and to a match is now a value rather than
  a database constraint — a match id was already Riot's own and is valid anywhere, and each row
  records the Riot ID of the account alongside whatever that account's id happened to be.
- **Which is what carries your footage across when you join a server.** Your account stops being
  "the first account on this PC" and becomes an id that server minted, and without the Riot ID
  beside it every recording you have made would quietly disappear from the list. There is a test
  for exactly that: a recording made before joining, found again afterwards, and not offered to
  somebody else on the same server.
- Fifty-eight new tests, twenty-five of them on what counts as a server address — Foxfire refuses
  plain http to anywhere but this machine, because a password and a month-long token travel over
  that connection.
- Deleting a match no longer clears the recording that names it. The foreign key that did so is
  gone, because in server mode the match is on somebody's homelab and nothing here could reach it —
  and keeping Riot's id is the better answer anyway: it still names the game, and still finds it if
  this database is later pointed at a server that has it.
- A server's answers are checked against the shapes this app reads, field name by field name. Two
  were already wrong when that check was written, and neither would have failed anything: a
  mismatched name arrives as nothing at all and renders as a blank where a number should be.

## [0.11.0] — 2026-08-24

Settings is rebuilt around a sidebar, taking after the Chrome settings page. Nothing is folded away
any more: the list of what exists lives permanently down the left, and one page at a time fills the
rest of the window.

### Changed

- **Settings has a sidebar, and no more folds.** It used to be seven collapsed cards in a narrow
  column, so finding anything meant opening things to see what was inside them and closing them
  again. The six categories now sit down the left where you can read them all at once, and clicking
  one shows that page in full — every control open, nothing hidden behind a chevron.
- **Ranked seasons moved onto the Rank tracking page.** It was only ever its own section because
  everything was a section. The dates decide which games belong to which season, which is what rank
  tracking is for, so that is where they live now.
- **Game capture is four groups instead of one long list** — OBS, Which games to record, Quality and
  Storage. It has roughly three times as many controls as any other page and they were all in a
  single undivided run.
- **Every setting reads the same way**: what it does on the left, the control that changes it on the
  right, several to a card. Explanations are kept where they teach you something and dropped where
  the label already said it.
- **Settings opens on Riot API key**, which is also where both of the key warnings take you when you
  click them.
- **A page says how it is doing in a sentence at the top**, rather than in one word beside a
  chevron — "Connected to the League client as…", "No key saved yet". Only actual problems are
  coloured now. A teal panel confirming that nothing is wrong was the loudest thing on a page where
  nothing had happened, and it trained the eye to skip the exact colour that matters when something
  does break.
- **The two buttons that open a separate window** — archived clients, and the telemetry panel — are
  rows with a leaving-the-page arrow on them, so it is clear before you click that they do.
- Riot replays has its own icon. It shared the film strip with Game capture, and the two sit next to
  each other in the sidebar.

### Under the hood

- Settings rows are now a small set of shared components — `SettingsRow`, `SettingsBlock`,
  `PathRow`, `LinkRow`, `StatusRow`, `ByteCapRow`, `StatRow` — plus one file of control classes.
  `PathRow` had been written twice with different props, the size cap twice and the stat strip
  twice, and the ghost button had drifted to three different paddings.
- `SettingsSection` and `Toggle` are deleted. The first existed to fold, and its `summary` prop
  existed only to stop folding hiding state; the second forced a description onto every switch.
- Surfaces re-stack the right way round. Cards used to be *darker* than the section holding them
  with inputs lighter again; the pane is now the darkest thing, cards sit above it and inputs above
  those.
- The selected category is component state rather than store state, since leaving Settings unmounts
  the view — which is the whole mechanism behind always opening on the Riot key.

## [0.10.3] — 2026-08-24

Loose ends from the 0.8.0 rebrand, in both directions: three icons that never got the new accent,
and one that should have kept Riot's gold and went blue along with everything else. Search also gets
the room its own layout always assumed it had.

### Fixed

- **Search no longer crops its match rows.** Making the window *wider* was what broke it: past
  1280px the screen adds the rank column down the left, but the page itself was capped narrower than
  that layout needs, so the item slots, the marker saying there is something to watch and the
  chevron were all quietly cut off the right-hand edge. Every other screen had the room; this one
  did not.
- **The Riot replays icon in Settings is the same blue as every other section.** It was the only one
  never given a colour, so it fell back to the cream the body text uses and read as gold beside Game
  capture directly above it.
- **The last two patches of the old gold are gone too** — the arrow on the queue dropdown, in Match
  history and on Champions, and the minimise, maximise and close symbols in the title bar. Both were
  still painted in the colour the app stopped using in 0.8.0.
- **Gold in the match scoreboard is gold again**, rather than the pale blue it turned when the accent
  colour changed. The coin also moved to the left of the figure, so all ten line up in a column
  instead of shifting a few pixels either way depending on whether a player finished on 8.9k or 15.2k.

### Under the hood

- A `--gold` token joins the palette, and carries a note saying why one is back after the accent
  deliberately stopped being Riot's gold in 0.8.0: it colours gold earned and nothing else — a
  quantity the game denominates, so it keeps the game's colour, the same exemption the role icons and
  rank crests already have. Explicitly not `--amber`, which means "something needs your attention"
  everywhere else in the app.

## [0.10.2] — 2026-08-21

Fixes recording never starting when you switch capture on with the app already open. Ticking the box
in Settings connected to OBS and looked entirely healthy, but nothing was listening for OBS to say it
had started — so every game armed, asked OBS to roll, and then sat there.

### Fixed

- Turning capture on in Settings now actually records. A session that had started with capture
  switched off could never reach Recording, however healthy everything looked, because OBS's
  confirmation had nowhere to go and no recording was written down. Restarting the app was the only
  way out, and nothing said so. Turning capture on and playing a game straight afterwards is the
  obvious way to try the feature, and it was the one way it could not work.
- The capture status now follows OBS connecting and disconnecting in that same session, rather than
  staying on whatever it said the moment the setting was switched on.
- The taskbar dot added in 0.10.1 works in that session too. It is drawn from the same status, so it
  could never turn red for a recording that never started, and it did not follow OBS coming and
  going either — including the amber that exists precisely to say a game is going unrecorded.

### Under the hood

- The OBS connection and record-state subscriptions moved above `initCapture`'s enabled check, so
  they are registered exactly once per process whatever the setting says at launch. `initCapture`
  refuses to run twice and `refreshCapture` never subscribed, so anything the disabled path skipped
  was skipped for the life of the process.
- A new `captureService` suite drives the service over stubbed OBS, live-client and database seams
  — arming, recording, stopping, and losing OBS mid-game — with the sequence that used to fail among
  them. Five of its six cases fail against the old wiring.

## [0.10.1] — 2026-08-21

The taskbar button now says what is happening. While a game is on it carries a coloured dot — teal
for playing, red for recording — and amber when a game is running that Foxfire was supposed to be
recording and cannot. That last one is the reason this exists: capture failing used to be silent
until you went looking for the video afterwards and found nothing.

### Added

- **A state dot on the taskbar icon.** Teal while a game is in progress, red while OBS is recording
  it, and amber when capture is switched on but OBS cannot be reached — so a game going quietly
  unrecorded says so while there is still something you can do about it. Recording takes precedence
  over the other two, which costs nothing: red already means a game is on.
- **The tray tooltip says the same thing**, instead of always reading "tracking rank". It is the one
  place the state still shows with the window closed to the tray, since hiding the window takes its
  taskbar button — and the dot on it — with it.

### Under the hood

- The badges are generated by `scripts/make-icon.mjs` alongside the `.ico` and the tray icon, from
  the same palette, and inlined into the main-process bundle the way the tray icon already is —
  `resources/` is not shipped, so a file path there would resolve in development and come back empty
  once installed. Two sizes each: Electron passes the shell a single image and Windows stretches it
  to whatever the display scaling asks for, so 16 and 32 are rendered separately from the vector and
  chosen at draw time rather than one being squeezed into the other.
- The state itself is derived by one pure function with its own tests, reading the same two statuses
  the Live tab's icon already reads, so the two cannot end up disagreeing.
- The app now claims an AppUserModelID matching the one the installer writes onto the shortcut.
  Without it Windows counts a running Foxfire and its pinned shortcut as two different applications
  and gives them two taskbar buttons.

## [0.10.0] — 2026-08-20

Riot's own replays. League saves a `.rofl` file for every game you record — the match itself, not a
video of your screen, so it plays back with a free camera and every player's point of view. Foxfire
now keeps those files, links each one to the game it came from, and hands them to the League client
to watch. What used to be called a replay in Foxfire was always an OBS video of your own screen, and
is now called a recording, which is what it is.

### Added

- A **Replays** tab, alongside **Recordings**, under the renamed **Captures** screen. Replays are
  picked up from League's own folder and copied somewhere Foxfire controls, so they survive being
  cleaned up. Each row says which patch it was recorded on.
- **Watch replay** on the match right-click menu, next to **Watch recording**. Both are always
  listed; whichever you do not have says so instead of disappearing.
- Manage archived clients, reached from Settings. A replay only runs on the patch that recorded it
  and League keeps just one install, so watching an older game needs that patch's game files —
  point Foxfire at any you have kept, or have it copy the current install before the next patch
  lands.
- Adding a replay by hand, by button or by dropping a `.rofl` onto the tab. If League's own name is
  still on the file it is linked to its game immediately; if the file was renamed, its scoreboard is
  matched against your match history instead.

### Changed

- Replays are now called **recordings** throughout, and the **Replays** screen is now **Captures**
  with a tab for each. The two are genuinely different things — one is a video of your screen, the
  other is Riot's own format — and sharing a name for them had stopped being tenable.

### Under the hood

- Two migrations. The first renames the `replays` table to `recordings` and frees the old name; the
  second gives it to the new one. They must stay in that order, and neither may ever be renamed —
  migrations are tracked by filename.
- A replay carries no bind state and no foreign key to its match. Riot names the file after the game
  (`NA1-5312345678.rofl` against a match id of `NA1_5312345678`), so the link is known at ingest and
  a plain join answers whether that game has synced yet. There is no binding pass to run and nothing
  that a failed sync can leave stale.
- Deleting a replay leaves a tombstone rather than removing the row. League's original file is never
  touched, so without one the next folder scan would import it straight back.
- Both `.rofl` containers are read. The current one keeps its patch as a length-prefixed string in
  the first thirty bytes and its scoreboard in the *last* hundred kilobytes, where the older one put
  both near the front — so each end of the file is read and the metadata is looked for in three
  places. A file that answers none of them is still listed and still opens; it just cannot say which
  client it needs.
- The patch is taken from the linked match when the file will not give it up. `info.gameVersion` is
  the same number from the other end, which keeps replays playable through a future format change.
- League's replay folder is found even when Documents is redirected to OneDrive, which is the
  default on a lot of Windows installs. The folder left behind at `%USERPROFILE%\Documents` still
  exists, so checking only the obvious path finds an empty directory and reports nothing wrong.
- Replays are played by asking the running League client over its local API, not by handing the file
  to Windows. The `.rofl` association is registered by the Riot Client only sometimes, and where it
  is missing the shell offers to open the replay in Notepad. The client route has no such failure
  mode, and the client has to be running to play a replay regardless.
- The client plays out of its own replay folder, so a replay it has since cleaned up is copied back
  there before it is asked to play. That is the moment Foxfire's own copies earn their disk.
- Launching against an archived install is not something Riot documents. It is attempted, and a
  failure shows the file in Explorer along with the command that was tried rather than doing nothing.
- The `replay://` scheme that serves recorded video became `recording://`, including in the content
  security policy that allows it.

## [0.9.0] — 2026-08-19

Survives a change of Riot API key. Riot encrypts player IDs against the key that asked for them, so
swapping a key — an expired personal one, or an approved application key finally arriving —
invalidated every ID this app had stored and stopped syncing outright, with nothing on screen but a
raw `400`. Foxfire now re-links each account from its Riot ID, the one handle a key change cannot
touch, and brings its match history across with it.

### Added

- A key type setting. An approved application key is allowed far more requests than a personal one,
  and telling Foxfire which you hold lets a backfill run at the speed your key was actually granted
  — the per-10-seconds and per-10-minutes allowances are yours to enter, since Riot sets them per
  application.

### Fixed

- Syncing after the API key changes. The first sync that meets a rejected player ID re-resolves the
  account and carries straight on, so an install whose key was replaced repairs itself without
  anything being re-downloaded or re-entered.
- Saving a new key re-links every tracked account there and then, and says how many it moved. An
  account it could not re-link — one whose Riot ID has since been renamed — is named, rather than
  left to fail quietly on the next sync.
- Adding an account you already track no longer creates a second, empty copy of it. It was matched
  on the stored player ID, which is exactly the thing a new key invalidates; it is matched on the
  Riot ID now, and re-adding an account repairs it.
- The expiry warning on the settings screen is gone when the saved key is an application key, which
  does not expire.

### Under the hood

- Re-linking rewrites the account's participant rows *and* the stored match payloads onto the new
  player ID, in one transaction. The payloads matter: several past migrations backfilled new columns
  by matching a participant row against the payload it came from, and leaving the two disagreeing
  would have broken that for every game played before the key changed — silently, and only when
  whichever migration came next filled a column with nulls.
- The identities an account used to have are kept in `account_puuids`. Nothing reads them; they are
  there so a player ID found in a log or a backup can still be traced to the account it belonged to.
- A 400 whose body says Riot could not decrypt the ID is now told apart from every other bad
  request. The body is classified and dropped rather than logged, since it quotes the ID back.

## [0.8.0] — 2026-08-19

LoL Stats is now Foxfire. The old name described the app but did not belong to it, and it carried a
competitor's into every identifier the project had — the installer, the registry, the folder your
data sits in. This release is that change, end to end: a new name, the app's first real logo, and an
accent colour that is the app's own rather than one borrowed from the game it reports on.

Your data comes with it. On first launch Foxfire moves everything LoL Stats left behind — match
history, hand-entered LP and seasons, the encrypted Riot key — into its own directory, and nothing
needs re-entering.

### Added

- A logo, for the first time. Three wisps circling an empty centre: foxfire is the light that hangs
  over rotting wood in a forest, and the flames Ahri carries. It appears in the title bar, on the
  About panel, on the taskbar and in the tray.

### Changed

- The app is called Foxfire everywhere it names itself — window titles, the tray, the installer and
  the Start menu entry.
- The accent colour is no longer Riot's gold. Riot's own art — the rank crests and the position
  icons — keeps Riot's palette; the app's own chrome no longer borrows it.
- Recordings made before this release keep playing. The folder they live in is now recorded
  explicitly rather than assumed, so renaming the default could not orphan them.

### Under the hood

- The data directory moves from `%APPDATA%/my-op-gg` to `%APPDATA%/Foxfire` on first launch, as one
  atomic move rather than a copy — there is no half-migrated state to recover from. If the old app
  is still running the move is refused with an explanation rather than attempted, because copying a
  database out from under a live connection is the one way this could have lost anything.
- Installing Foxfire leaves LoL Stats in place. It is a separate application as far as Windows is
  concerned, so uninstall the old one once you are satisfied the move worked.
- OBS's managed profile and scene collection are renamed too, which orphans the old ones — OBS
  keeps them, and your own scenes were never touched either way. The prefix that tells this app's
  audio inputs from your own is now a named constant shared with them, rather than a string
  repeated inside a comparator where it could quietly drift.
- The mark has one definition, in `src/shared/logoMark.json`, which the app, the `.ico` and the tray
  icon all draw from. The tray icon used to be a base64 blob pasted in by hand next to a comment
  asking that it be kept in step with the build script.
- Colour tokens are named `--accent` / `--accent-dim` rather than `--gold`, so the next change of
  mind does not leave every component claiming a colour it no longer renders.

## [0.7.2] — 2026-08-19

Fixes recordings that never find their game. If your API key expired while you played, the games
were recorded fine and the matches turned up on the next sync — but the two were never introduced,
so the recordings sat reading "Matching…" forever with no way to nudge them.

### Fixed

- Recordings now find their game after any sync, not just the automatic one that runs when a game
  ends. Pressing Sync now is enough — including when it brings in nothing new, which is exactly
  what happens once a fresh key has already collected the missing matches.
- Opening the app pairs any waiting recording with what is already stored, before it talks to Riot
  at all. An expired key is usually why a recording is still waiting, so it should not also be what
  stops it being matched.
- A recording is no longer written off as having no match while syncing is broken. Giving up used
  to depend only on how long ago you played, so an expired key was enough to make the app conclude
  a game did not exist — permanently, with nothing that could change its mind. It now gives up only
  after a sync that actually worked, and a recording already written off is looked at again for a
  week in case its match was simply missing.
- A recording that stops while the match is already synced is matched immediately instead of
  waiting for the next sync. The attempt had been running against a session the app had just
  cleared, so it never actually looked.

### Under the hood

- Migration 009 widens the replay index to cover both states the binding pass now reads.
- Writing a recording off is behind an explicit `allowGiveUp`, off by default, so only a caller
  that can vouch for the sync being complete is able to reach that decision.
- A new `replayService` test suite covers the pass end to end against real SQLite, including the
  expired-key sequence that prompted all of this.

## [0.7.1] — 2026-08-19

Fixes ranked games showing 0 LP. The League client keeps reporting the rank you went into a game
with for a few seconds after that game ends, and LoL Stats was writing that stale number down as
the result — so the game looked like it had been worth nothing, and the LP it was actually worth
was thrown away.

### Fixed

- Ranked games no longer register as 0 LP when the client is slow to update. The post-game reading
  is now given a minute to settle before an unchanged one is believed, so the real number is the
  one that lands on the match row.
- A finished solo game no longer writes a rank reading for flex as well. It could close an
  unresolved flex interval at a value nothing had measured, costing a flex game its LP.

### Under the hood

- The wait is a small state machine of its own, kept out of the LCU watcher so it can be tested
  without playing a ranked game and losing it. Two tests replay the incident that prompted this,
  one showing the 0 LP it produced and one the -7 and +21 it should have.

## [0.7.0] — 2026-08-18

Games can now record themselves. With OBS installed, LoL Stats captures each game as you play it
and marks the seek bar with your kills, deaths and multikills — so finding the fight you threw is
two clicks rather than a scrub hunt through half an hour of footage.

This release also teaches the app what a ranked season is — you tell it when each one started, in
Settings — so that when January resets everyone's rank the climb you spent a year on stays readable
instead of turning into one long cliff.

The Live game screen is also rebuilt. It now reads the game running on this PC instead of asking
Riot about it, which is what lets it show lane order, items, runes and a running score — and what
costs it the ability to look at a game running anywhere else.

### Added

- Game capture, driven through OBS. Turn it on in Settings, pick the queues worth recording, and
  each game is written to a folder you choose. OBS does the encoding, so it uses your graphics
  card rather than fighting the game for CPU during the game.
- Two ways to set OBS up. **Set OBS up for me** builds a profile and scene collection of its own
  and switches into them only while recording, so a setup you already stream with is never
  touched. **Use my own scene** records with a scene you built and reports anything that would
  stop the recording playing instead of changing it. A live preview shows the frame OBS would
  capture, so setup can be checked before a game rather than after one.
- Replays open in their own window, with the player's own controls: play, scrub, volume,
  fullscreen, quarter-speed to double-speed, and buttons that hop between events. Space, the arrow
  keys and `,` / `.` do the same from the keyboard.
- An event timeline on the seek bar, marked with your kills, deaths, assists and multikills.
  Clicking one seeks to a few seconds before it, because the approach to a fight explains more than
  the moment somebody dies. Hovering anywhere shows the frame at that timestamp.
- Right-click a match to watch its replay. A game with no recording says so on the menu item
  rather than hiding it, and a match row that has one is marked, so you can see at a glance which
  games there is footage of without right-clicking them one at a time.
- Every replay window owns one replay, so several can be open at once — the same game at two
  timestamps on two monitors, or two games side by side.
- A **View match history** button on a replay, which brings the main window forward with that
  match expanded.
- A **Replays** screen listing every recording, whether or not it found its match, with what it is
  using on disk and controls to delete it or open its folder. Recordings that never match a game —
  Practice Tool produces no match history entry at all — stay here and stay watchable.
- A capture indicator in the title bar, and a line on the Live game screen while a game is being
  recorded, so a recording that silently failed is noticed before the game rather than after it.
- The Live game tab turns teal while a game is in progress, and its centre dot turns red while that
  game is being recorded — both facts readable from the nav without opening anything.
- A recording quality setting — 720p or 1080p, 30 or 60fps, with the rough disk cost of each. Turn
  it down if capture costs you frames in game; it changes what the encoder works on, not what you
  see while playing.
- An advisory disk warning you set yourself. Nothing is ever deleted automatically; crossing the
  number shows a warning with a one-click clear-out of the oldest games.
- A season picker on the Rank and Champions screens. Rank sits it beside the 7- and 30-day ranges,
  Champions beside the queue filter, and both open on the most recent season you have games in.
  Champion win rates have until now blended every season you have ever played into one figure, so
  a champion you gave up on two seasons ago was still dragging on the number.
- Ranked seasons are set in Settings, because Riot offers no way to ask when one started. Each
  season is a name and a start date, runs until the next one begins, and the newest never ends — so
  nothing breaks if you add January a few weeks late, and a preseason that drags into February is a
  row you add rather than a date the app got wrong. It ships knowing when the 2026 season opened.
- A **Rank was reset** tick on each season, for the seasons where the ladder was actually emptied
  and you played placements. That is what keeps the reset from being recorded as a game that cost
  you two thousand LP, and it is separate from the season boundary on purpose: rank carries into a
  preseason, so a game either side of one still earned its LP.
- The Rank screen's "All" now draws each season as its own line. January empties the ladder rather
  than demoting anybody, so a line drawn straight through the reset would show a fall that never
  happened, and the net LP figure is left off entirely on a view that spans one.
- The Live game screen is a recreation of the in-game scoreboard: both teams in lane order — top,
  jungle, mid, bot, support — with each player's level, items, runes, K/D/A, CS, ward score, rank
  and respawn timer, updated as the game plays. Lane order was the original ask, and it was
  impossible from where the screen used to get its data.

### Changed

- Recording starts when the game itself comes up rather than when the client says a game began.
  The client reports a game at the loading screen, minutes early, and starting there records a
  black screen OBS has no window to capture yet.
- Settings folds. Every section is collapsed by default and each one reports the fact worth
  knowing while it is shut — whether a key is saved, whether recording is on, how many seasons are
  set — so the page is a list of what exists rather than a scroll through all of it. The Riot key
  says so in amber when it is missing, since nothing else works without one.
- The Live game screen reads the game running on this PC rather than asking Riot. The game serves
  its own view of itself on loopback, with no key and no rate limit, and that one carries a
  position for each player — which is what makes lane order, and everything beside it, possible.
  Riot's spectator endpoint sent a champion, a team and two summoner spells per player and no
  position at all, so the rows had been sitting in Riot's array order because there was nothing to
  sort by.
- The Riot ID examples on the Add account form and on Search no longer name the app's author. They
  are drawn from a pool of pros each time either form opens, with region-accurate tags — Faker#KR1,
  Caps#EUW, Uzi#CN. A pool rather than one replacement name, because whoever got picked would
  become the account the app implicitly points at; and accurate tags because someone who has only
  ever seen #NA1 tends to assume that is the shape of every tag.

### Removed

- Checking a live game from another PC, and seeing the lobby during champion select. Both came from
  Riot's spectator endpoint, which nothing now calls: it carried none of what the new scoreboard
  shows, and keeping it alongside would have meant two Live game screens that agree on nothing.
  Nothing answers on loopback until the game process itself starts, so there is nothing to show
  before then.

### Fixed

- January's rank reset can no longer be recorded as a game that lost you two thousand LP. LP is
  worked out from the gap between two rank readings, and the gap spanning New Year holds the whole
  height of your rank; if a single ranked game happened to sit in it, that game was handed the lot.
  It would also have come back on every launch, because the repair pass that rebuilds LP runs over
  all of history each time. Two readings either side of a season marked as having reset the ladder
  are now never compared.
- A reset no longer appears in the milestone list as a demotion — "Demoted to Bronze IV" every
  January, for the rest of the account's life.
- The account rail no longer closes the Add account form when the pointer slips out of it. Typing a
  Riot ID takes long enough that a wrist brushing the trackpad, or a nudge past the edge of a strip
  224px wide, was enough to unmount the form — and it took the half-typed ID and any error message
  with it. An open form now holds the rail open, and Escape or a click outside dismisses it.

### Under the hood

- A recording is tied to its match by fingerprinting the roster — the ten champions plus the one
  you played. A live game carries no match id anywhere, and matching on end time alone picks the
  wrong game when two finish within a few minutes of each other. The attempt runs off the existing
  post-game sync retries, since that is the only moment a new match can appear.
- Migration 007 adds the `replays` and `replay_events` tables. Deleting a match sets a replay's
  match id to null rather than cascading: losing a match row must never destroy footage.
- Events come from the Live Client Data API the game already serves on loopback, polled while
  recording and written as they arrive, so a crash costs one poll rather than the whole timeline.
  The endpoint resends every event each call, so the write is an upsert on the game's own event id.
- Video reaches the replay window over a `replay://` scheme rather than `file://`. The renderer
  sends a replay id and never a path, the file is confirmed to be inside the replay folder, and
  byte ranges are served properly so seeking works.
- Managed mode sets the resolution, frame rate and recording quality preset it records with, rather
  than inheriting OBS's defaults for a new profile — which were 720p30 at a constant 6 Mbps, a
  bitrate that resolution and frame rate could not spend. They are re-applied before every
  recording, so a profile built by an earlier version picks up a changed setting.
- MP4 is required and MKV is refused with an explanation. MKV is OBS's default and records
  perfectly; Chromium simply has no demuxer for it, so the file would be written and then never
  play.
- The obs-websocket password is stored encrypted beside the Riot API key rather than in the
  database, and never crosses IPC — only whether one is set.
- `obs-websocket-js` is the one new runtime dependency. It is pure JavaScript, so nothing about the
  build or the installer changes.
- The capture state machine, the event mapping, the roster fingerprint, the OBS validation rules
  and the timeline's marker clustering are all pure modules with tests. None of their interesting
  cases — a dodge, a loading screen that never ends, a game that crashes mid-recording, two games
  finishing minutes apart — can be produced on demand by playing League.
- Season boundaries are hand-entered rather than derived. Riot publishes no way to ask which season
  is current — the static season list stopped updating in 2019, ranked entries carry no season
  field, and the match API dropped the one it used to send. Deriving one from the calendar was
  tried first and is wrong: 2026 opened on 8 January, so a hard 1 January cut misfiles a week of
  games every year with nothing anyone can do about it. Migration 008 adds the table and seeds the
  one date that could be verified.
- Each reading is stamped with the season it falls in as it is read, so the chart knows where one
  climb ends without holding a copy of the table and cannot draw before that table has loaded.
- Season bounds are computed once in TypeScript and passed to SQL as parameters, never as a SQL
  year expression. SQLite would resolve one in UTC while the app decides in local time, which would
  put a New Year's Eve game in different seasons on the rank graph and the champions table.
- The season pickers span an account's oldest and newest record rather than listing only the
  seasons it has games in, so a season off from the game still appears between two played ones
  rather than leaving a hole that reads as lost data. The oldest season reaches backwards forever
  and the newest forwards, so no game can fall outside every season and a boundary nobody has
  entered yet cannot cut the current one short.
- The dev harness gains an earlier season ending the December before, plus a preseason between the
  two, which is what makes any of this checkable before January: the picker has three entries, the
  all-time chart has a boundary to break at, the reset has a game beside it to wrongly attribute,
  and the preseason proves a carry-over boundary still attributes normally. It is additive — the
  existing 301-game climb and the three exact invariants it rests on are untouched.
- Rank is the only thing on the live scoreboard that still reaches Riot. The game names players
  without identifying them, so each Riot ID is resolved to a puuid before a ladder can be asked
  about it — fetched per row so the board paints without waiting, and cached well past the poll.
- The loopback port refuses connections and then 404s for about three seconds while the game
  process starts. That is an ordinary state rather than a fault; reporting it as one put an error
  on screen every time somebody queued.
- Behaviour was confirmed against a live payload rather than assumed, and a real ARAM corrected two
  guesses: a mode without lanes reports `"NONE"` rather than the empty string match-v5 uses, and a
  player the game has no identity for arrives named with empty strings — which `??` does not catch,
  and which sent a blank Riot ID off to be looked up.
- The example Riot ID pool is asserted to survive `parseRiotId`. That is the failure worth
  guarding: a typo'd entry would ship a placeholder the app itself rejects, and nothing else would
  catch it.

## [0.6.0] — 2026-08-17

The live game screen no longer empties itself when one player asks not to be named, and match rows
gained the eighth item they had been dropping — in bot lane, that item is the boots.

### Added

- Match rows and match detail show the role quest reward next to the six bought items and the
  trinket. Bot lane's reward is the player's boots, so bot rows had been showing a finished build
  with nothing on its feet. Matches already in your history get it too, with no re-sync.

### Fixed

- A live game with a withheld player renders again. Riot hides some players' identities, and a
  single hidden one used to replace the entire roster with a validation dump — nine visible players
  lost to the one that was not.
- A withheld player now shows as their champion, unnamed and without a rank, which is what was
  asked. The app had been resolving the name by another route, going around the withholding rather
  than respecting it.
- Selling an item no longer punches a hole through the middle of a build, with another item
  stranded past the trinket. The six bought slots close up to the left while the trinket and quest
  reward stay pinned to the right, so every row stays eight wide and the strips keep their columns
  down a list mixing Summoner's Rift with ARAM.

### Under the hood

- Migration 006 backfills the quest reward from the full payloads stored since 001, so history is
  recovered locally with no Riot calls. It takes its own column rather than a seventh inventory
  slot: it is granted by the lane rather than bought.
- Every field on a live game participant is now optional, so no single missing value can fail the
  parse for all ten. The cost is that this endpoint stops reporting payload drift as a parse error —
  a shape change now arrives as empty fields for the mapper to absorb.
- The participant-name lookup is gone along with the behaviour it served: its IPC channel, handler,
  preload binding, and the account endpoint that removal left orphaned.
- Live game mapping moved into its own module, so its tests need neither a database nor an API key.
- The release workflow runs `actions/checkout@v5`; v4 targets a Node version GitHub has deprecated.

## [0.5.0] — 2026-08-17

The app now tells you which version you are running, and these notes exist.

### Added

- Settings → About shows the running version, so a patch note can be matched against the build in
  front of you. There had been no way to tell from inside the app.

### Under the hood

- This file, backfilled to cover every release since the first build.
- Pushing a `v*` tag publishes a GitHub Release whose body is that version's section here, so the
  file and the release can never disagree.
- `CLAUDE.md` records the rule that keeps it current: the pull request that bumps the version writes
  the section.

## [0.4.1] — 2026-08-17

A one-line fix to the window header.

### Fixed

- The hairline under the app header stopped short of the right edge and died in mid-air beside the
  window buttons. Windows paints its own minimise/maximise/close controls over the top 40px of the
  page, and the border sat in exactly that band. It now runs the full width of the window, at both
  normal and maximised size.

## [0.4.0] — 2026-08-17

LP per game is worked out by comparing rank readings taken before and after, which only produces an
answer when exactly one ranked game sits between two readings. Play a session with the League client
closed and the whole run collapses into a single interval that cannot be split — every game in it
stays blank. You usually know the answer; there was no way to say so. Now there is.

### Added

- Right-click a match in your history and choose to edit its LP. The editor opens in its own window,
  listing your ranked games newest first.
- Type a bare LP number and it lands in the right division on its own, so most rows need nothing but
  the number.
- Stating your rank after one game is often enough to unblock its neighbours. Three unresolved games
  in a row become three single-game intervals once you fill in two of them, and the third resolves
  by itself.
- Games that cannot be edited keep the menu item, disabled with the reason — "why does this game
  have no LP?" is the question the editor exists to answer.

### Changed

- Hand-entered LP renders identically to LP the app worked out itself. This is deliberate: being
  hand-entered drives whether a live reading supersedes it and whether it can be cleared, not how it
  looks.

### Fixed

- Running from a git worktree, the dev server refused to serve the bundled fonts, so the app fell
  back to system fonts and looked broken when it was not.

### Under the hood

- An edit is stored as a rank reading rather than an attribution row, so one entry produces the LP
  chip, the promotion crest, the milestones and the graph at once — and because attribution
  recomputes the same value from it on every run, an entry needs no protection from being
  overwritten.
- Migration 005 adds a nullable `rank_snapshots.match_id`, so clearing an entry is a targeted delete
  and re-editing is an update rather than a second conflicting row at the same instant.
- The editor is a third window, hash-routed off the shared renderer bundle like the telemetry panel.

## [0.3.0] — 2026-08-16

Three changes to the rank graph, all visible on the Rank screen.

### Changed

- The line's corners are rounded instead of hard. Deliberately not a spline — a curve fitted through
  the points would overshoot between them, bulging across a tier boundary you never crossed and
  contradicting the milestone list drawn underneath. Rounding only cuts a corner, so it cannot
  invent a value you never had.
- The line takes its colour from the tier you were in at each moment, rather than painting the whole
  climb in your current tier. The switch happens exactly at the reading that first reported the new
  tier, so a segment ending in a promotion is drawn in the tier it was climbing out of.
- Dots on every point are gone. Rounding a corner cuts it, so mid-series dots detached from the line
  at spikes. The first and last points keep theirs, and the point you hover gets one at its true
  position.

### Under the hood

- The telemetry charts share the same corner rounding, except stepped counter series, which opt out
  — rounding those would draw a ramp where the counter actually jumped.
- The browser dev harness gains a second account with a generated 30-day, 301-game climb from Silver
  II to Platinum III, and its match history, rank readings, champion stats and mastery are now keyed
  per account rather than shared.

## [0.2.2] — 2026-08-16

Nothing stopped the app running twice, and two copies share everything durable they own.

### Fixed

- Launching the app while it is already running now raises the existing window instead of starting a
  second copy. Both copies had been sharing the same two databases, the same log file and the same
  saved API key — and, most damagingly, running a second Riot rate-limit queue against one key, so
  both started collecting rate-limit errors. Worst at launch, where every account syncs at once.
  This was easy to do by accident rather than hypothetical: with tray mode on, closing the window
  only hides it, so nothing on screen suggested the app was already running.
- A window created through the tray's fallback path could quit the app when closed in tray mode.

## [0.2.1] — 2026-08-16

Two reported bugs with one shared cause: nothing ever synced automatically, and LP attribution ran
too early to ever succeed.

### Fixed

- Finishing a game now pulls the match in on its own. The one automatic "a game ended" signal only
  refreshed the screen without fetching anything, and the match list reads from local storage — so
  it re-read the same rows and the finished game never appeared until you pressed Sync now.
- LP chips now actually appear. They had never rendered in a real install: attribution ran about 50
  seconds after a game ended, before Riot publishes the match, found nothing, and nothing ever
  re-triggered it. Across 108 matches it had written zero rows. It now replays after every sync, so
  whichever lands second — the match or the rank reading — the next pass closes the gap. It also
  backfills history recorded before this worked.
- A loss at 0 LP with demotion protection reads identically to the previous rank reading, so it used
  to be discarded — which left the interval open and swallowed the next game's LP figure too.

### Changed

- Automatic post-game syncs no longer flash the progress bar. A full backfill still shows one;
  hiding that would read as the app having frozen.

### Under the hood

- The end of a game is detected from the League client's game phase, firing on entry to an end phase
  so a mid-game reconnect never triggers it, then retrying on a widening schedule until the match
  appears — Riot's publish delay varies, and a single attempt would look fixed some evenings and
  broken on others.
- The attribution repair runs at launch, before the sync and independent of it. It only touches
  local data, and gating it on a Riot call meant an expired key skipped the backfill precisely when
  the key needed replacing.
- Colliding sync callers now join the running sync instead of being dropped silently, which is why
  Sync now could read as dead after a reload.
- A rejected API key is held as readable state rather than only broadcast as an event. The launch
  sync fails within ~325ms of the window opening, before anything subscribes, so the warning landed
  on nobody and a dead key became invisible.

## [0.2.0] — 2026-08-15

The app worked but looked unfinished, and it mixed every queue into one set of numbers. This release
is the visual overhaul, plus queue filtering, rank history, a richer champions table and a real
application icon.

### Added

- A Hextech-styled dark interface: real design tokens, Riot's own two golds, hand-drawn icons in
  place of literal characters, self-hosted fonts, and genuine ranked crests and position icons.
- Match rows now carry what op.gg's equivalent does — result, champion, summoner spells, runes,
  role, KDA, CS/min, kill participation, damage share, items and multi-kill badges. None of this
  needed a single new Riot API call; the data was already stored and simply never shown.
- Expanding a match surfaces gold, damage taken and role for the first time, with damage normalised
  across the whole lobby rather than per team.
- A queue filter on both match history and champion stats, defaulting to Ranked Solo/Duo. Champion
  stats could not filter at all before this, so ARAM and Normals inflated the same win rate as
  Ranked.
- A Rank page charting your climb, with per-game LP chips in match history. Rank had only ever been
  a current value that every refresh overwrote; readings are now kept.
- A richer Champions page that opens on games played rather than mastery, with bars showing the
  stats behind each row.
- A recent-form summary above the match list, worked out from the rows already on screen so it can
  never disagree with them.
- An application icon. Packaged builds had been shipping with the generic Electron logo — the
  executable, the installer, the desktop shortcut and Add/Remove Programs all fell back to it.
- A native-feeling title bar that keeps Windows' own caption buttons and snap layouts.

### Changed

- Below 1280px the identity rail folds into a horizontal strip. The two columns cannot both fit
  before match rows start clipping their item slots.
- Designed loading, empty and error states throughout. A personal Riot key expires every 24 hours,
  so these are routine rather than exceptional.
- The Riot disclaimer moved from a footer on every screen to Settings.

### Fixed

- Remakes are excluded from win rates, recent form and LP attribution. They award no LP and say
  nothing about a champion, and counting them was why these numbers disagreed with op.gg by exactly
  three games.
- Match history paged from offset 0 while growing its limit, the Champions refresh button could
  never pull fresh mastery, and a sync did not invalidate champion stats despite having just
  recomputed them from the matches it imported.

### Under the hood

- Developer telemetry: Riot API request timing, rate-limit headroom, per-process CPU and memory,
  League client status, logs and spans — in its own window, its own database, off by default and
  toggled from Settings. The app previously had no observability at all: two `console.error` calls,
  no timing anywhere, no log file and no crash handler.
- Rotating logs in the user data folder, process crash handlers and an error boundary. Warnings and
  errors are written whatever the telemetry setting says, so a crash still leaves a trace with
  collection off.
- Riot response validation moved inside the instrumented request, so a changed payload is recorded
  against the request that carried it instead of logging a clean success and failing elsewhere.
  Concrete request paths embed account identifiers, so they are only ever stored hashed.
- Migrations 002 and 004 backfill largest multi-kill and the remake flag from payloads already
  stored, so neither needs a re-sync.
- `npm run dev:web` runs every screen and state in a browser against fixture data, with no Riot key
  and no synced database.
- No invented metrics: deliberately no OP-Score substitute, no MVP or ACE, no placement. Multi-kill
  is measured, so it stayed.

## [0.1.0] — 2026-08-14

The first build. An ad-free desktop alternative to op.gg for tracking your own accounts, with every
figure coming from Riot's official Developer API rather than scraped from op.gg.

### Added

- Profile, rank, match history, live game and champion mastery.
- Match history is stored locally and served from disk — Riot is only called when syncing.
- Adding an account returns after about three API calls, then backfills your match history in the
  background with progress. Each match is committed as it arrives and stored matches are skipped, so
  an interrupted backfill resumes rather than starting over.

### Under the hood

- Only the main process touches the Riot API or the database; the interface reaches them through a
  narrow typed bridge with context isolation on.
- Every Riot call passes through one app-wide rate limiter, so backfill, live-game checks and search
  share a single fair queue.
- The API key is validated against Riot before being saved, then encrypted and stored outside the
  database file.
- An expired key fails queued work immediately and prompts for a new one, rather than stalling the
  queue indefinitely. Personal keys last 24 hours.
- Storage uses Node's built-in SQLite rather than a native module, avoiding a compilation step and
  the rebuild machinery that comes with it.

[0.14.0]: https://github.com/xalluna/foxfire/compare/desktop-v0.13.0...desktop-v0.14.0
[0.13.0]: https://github.com/xalluna/foxfire/compare/desktop-v0.12.0...desktop-v0.13.0
[0.12.0]: https://github.com/xalluna/foxfire/compare/v0.11.0...desktop-v0.12.0
[0.11.0]: https://github.com/xalluna/foxfire/compare/v0.10.3...v0.11.0
[0.10.3]: https://github.com/xalluna/foxfire/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/xalluna/foxfire/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/xalluna/foxfire/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/xalluna/foxfire/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/xalluna/foxfire/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/xalluna/foxfire/compare/v0.7.2...v0.8.0
[0.7.2]: https://github.com/xalluna/my-op-gg/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/xalluna/my-op-gg/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/xalluna/my-op-gg/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/xalluna/my-op-gg/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/xalluna/my-op-gg/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/xalluna/my-op-gg/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/xalluna/my-op-gg/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/xalluna/my-op-gg/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/xalluna/my-op-gg/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/xalluna/my-op-gg/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xalluna/my-op-gg/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xalluna/my-op-gg/releases/tag/v0.1.0
