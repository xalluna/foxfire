# Foxfire Server changelog

The record of what the server shipped when, kept separately from the desktop's
`apps/desktop/CHANGELOG.md` because the two release on their own tags and their
own schedules — `server-v*` here, `desktop-v*` there.

The web client has no changelog of its own: it ships inside the server, so what
changed in it is recorded here, in the release that carries it.

The same doctrine applies: any PR that bumps `VersionPrefix` in
`apps/server/Directory.Build.props` adds that version's section in the same
commit, and there is no `[Unreleased]` section.

## [0.2.1] — 2026-09-22

Accepts Foxfire 0.14.0, the first desktop that updates itself — and which asks this server which
version to update to.

### Added

- **Serves Foxfire 0.14.0.** A desktop from 0.14.0 on reads `recommendedDesktop` from `/version`
  and installs that build, so the allow list here is now what decides which version the people on
  your server are running. They move when you update the server, and not before — a desktop never
  updates past what its server will talk to.

### Under the hood

- Server releases are no longer marked as the repository's Latest release. That badge is what a
  browser lands on, and what the desktop's updater reads the newest desktop version from, so it
  belongs to the desktop installer. The container image is unaffected: `:latest` on GHCR still
  follows every server release.

## [0.2.0] — 2026-09-21

Foxfire in a browser. The server now hosts a web client of its own, so your
members can read match history, LP, the rank graph and shared replays from any
browser with nothing to install — and send each other links to them.

### Added

- **A web client, served by the server itself.** Open your server's address in a
  browser and sign in: profiles, match history with what each game was worth in
  LP, a page for every game, champion stats and the rank graph, for every account
  on the server. It comes from the same address as the API, so there is nothing
  else to host and nothing to configure — the address your members connect the
  desktop to is the one their browser opens. Laid out for a desktop screen and
  still readable on a phone.
- **Links worth sending.** Every profile, rank graph and game has an address,
  and "Copy link" puts it on the clipboard with the view it was copied from —
  queue, period and all — so whoever opens it sees what you saw. Links are for
  members: opening one asks you to sign in first, then goes where it pointed.
- **Your own LP and syncs, from the browser.** Whoever claimed an account can
  type in what a game was worth and start a sync, as on the desktop. Everybody
  else's history reads as it always has, and stays theirs to change.
- **Running the server from the browser.** Members and invites, public sign-up,
  storage, unlinking accounts and removing replays — the same pages the desktop
  has. Importing an old Foxfire database works there too: the browser reads the
  `stats.db` itself and sends it up, so a host without the desktop to hand can
  still bring a community's history across. A very large one is better imported
  from the desktop, which does not hold the whole file in memory while it works.
- **Invite links open a sign-up page.** The link the server hands out, or emails,
  now opens a form with the invited address already filled in, rather than a page
  that could only say "paste this into Foxfire". The same link still works in the
  desktop.
- **Registering in the browser**, on a server with public sign-up, or with an
  invite on one without.
- **Rate limits on signing in, registering and searching**, per address: twenty a
  minute for the first two together and thirty searches, both adjustable. A server
  on the internet will have somebody guessing passwords at it, and every search is
  a live call on the one Riot key everybody shares. Staying signed in is never
  limited, so a household reloading its tabs cannot lock itself out.

### Changed

- **The API moved under `/api`**, which is what lets one address serve both the
  web client's pages and the API. Foxfire desktop 0.12.0 keeps working unchanged:
  its requests are recognised and moved there. A reverse proxy in front of the
  server should forward every path to it — the web client's pages as well as
  `/api` — along with the WebSocket upgrade on `/api/hub` and, for 0.12.0, on
  `/hub`.
- **`/version` also says where the API is and the server's public address**,
  which is what the desktop's "Copy link" is built on.
- **Serves Foxfire desktop 0.13.0**, alongside 0.12.0. 0.13.0 talks to `/api`
  directly and offers "Copy link" into this server's web client.
- **New, optional settings in `.env`:** `TRUSTED_PROXIES` and
  `TRUSTED_PROXY_NETWORKS`, which say whose word to take on a member's real
  address, and `RATE_LIMIT_AUTH_PER_MINUTE` and `RATE_LIMIT_SEARCH_PER_MINUTE`.
  And one existing setting matters more now: a browser will not download a
  replay over plain http from a page served over https, so behind TLS
  `BLOB_PUBLIC_URL` should be https as well.

### Removed

- **The server-rendered invite page.** Invite links open the web client's sign-up
  page instead.

### Under the hood

- **The web client never sees its refresh token.** It travels as an httpOnly,
  Secure, SameSite=Strict cookie that only the auth routes receive, so a script
  injected into a page has no month-long credential to steal; the access token
  lives in the page's memory for its fifteen minutes. Tabs take turns refreshing,
  because two refreshing at once would present the same token twice — which the
  server reads as a stolen copy, ending every session its owner has. The
  desktop's sessions are unchanged.
- **A tab left open across an upgrade is told to reload.** The web client says
  which API version its page was built against and the server lists the ones it
  serves, so a page from before an upgrade gets a prompt to reload rather than
  answers it would misread.
- **Pages are sent with a content security policy**, `noindex`, a same-origin
  referrer policy — so an invite token in a page's address is never sent to
  Riot's image CDN — and `nosniff`. Fingerprinted assets are cached for good and
  everything else is checked on every load, so an upgrade reaches an open browser
  the next time it navigates. An API route that does not exist answers with a
  JSON 404, never a web page.
- **Behind a reverse proxy, the rate limits count your members' addresses** rather
  than the proxy's — believed only from the proxies you name. The compose file
  trusts Docker's own networks, which is right while the server's port is
  published on localhost only, as it is by default.
- **The web client is built into the container image and both archives**, from
  the repository's lockfile, and a release checks that each archive carries it.
- **One game can be read as one player's row**, LP included, which is what the
  page for a single game opens with.
- Tests: the API suite now calls everything under `/api`, and new suites cover the
  web client's hosting and headers, desktop 0.12.0's requests at their old
  addresses, the web session cookie — its attributes, rotation, reuse detection
  through it, signing out — and the rate limits, including that a forwarded
  address is believed only from a trusted proxy. One reads the web client's API
  version out of `packages/core` and fails if the server does not serve it.

## [0.1.0] — 2026-09-17

The first thing that runs. You can stand a server up, register on it, sign in,
say which League accounts are yours, and have it fetch and keep everybody's
match history for you.

### Added

- **Foxfire accounts.** Register with a username, an email and a password; sign
  in with the email. The username is what shows next to your games and is yours
  to pick; the email is the login, because it is the thing you cannot forget and
  the thing a password reset has to reach anyway.
- **Invites.** With public signup switched off, an admin creates an invite for
  an address and gets a link. The link works every time it is clicked and
  completes exactly one registration — clicking is a read, and spending it is a
  row written inside the transaction that creates the account. Following it in a
  browser lands on a small page that explains itself and hands over the code to
  paste into Foxfire.
- **Public signup, on by default.** A community server nobody can join is the
  less useful way to be wrong by accident. Turning it off makes the server
  invite-only.
- **Riot account linking.** The desktop reports the Riot ID the League client
  running on that machine says is logged in; the server resolves it through
  Riot and files it. A League account belongs to at most one Foxfire account at
  a time, first claim wins, and an admin can unlink — which is what makes a lock
  that is not proof survivable on a server whose admin knows everybody.
- **Match history, fetched by the server and shared by everybody on it.** Link
  an account and the server fills in its recent games; play one and it picks
  that up by itself. A game ten people played is stored once, so the second
  person on the server to have played it gets it for free — which on one shared
  Riot key is the difference between a friend joining costing an afternoon of
  requests and costing almost none.
- **LP on each match row.** The server records where you stood whenever it can
  see — from your League client while you play, and from Riot after every
  sync — and works out what a game was worth whenever exactly one ranked game
  sits between two readings. When several do, it says nothing rather than
  splitting a guess between them.
- **It waits for Riot rather than missing the game.** A match is not published
  the moment it ends, and how long that takes varies, so the server tries again
  at thirty seconds, ninety, three minutes, six and ten. That schedule belongs
  to the server now, which means it keeps going after you close your laptop, and
  two people who were in the same game do not both run it.
- **Live progress, and three other things the server pushes.** A backfill of a few hundred games
  takes minutes on a shared key, so the desktop is told how far through it is as it goes — and so
  is told when somebody types an LP figure by hand, when a League client reports a rank that moved,
  and when Riot refuses this server's key. That last one is pushed the moment it happens, because
  the moment it happens is usually the middle of the night and the people who need to know are
  asleep.
- **A storage summary for whoever is paying for the disk.** Replay count and bytes as the blob
  store itself reports them, beside the database's own counts — and a warning when the two disagree
  about how many replays exist, which means a delete failed on one side. There is no "delete
  everything": a full store refuses an upload, which is recoverable, and one click between a
  community and its history is not.
- **Importing an existing Foxfire database.** An admin points the desktop at an old `stats.db`
  and everything in it lands here. Every player id in that file is dead on arrival — Riot encrypts
  them against the key that asked, and that was somebody's desktop — so accounts are re-resolved
  from their Riot ID first, and every later batch is translated through what that recorded. LP is
  not imported at all: it is derived from the readings, which are, so the server works it out
  itself once everything has arrived.
- **A shared replay library.** Riot writes one .rofl per game, identical for
  all ten players, so one upload serves everybody who was in it — and the client
  that plays it is one everybody already has. A game a friend played is watchable
  from inside your own client, every camera angle, for the cost of an upload
  nobody had to coordinate. The match row says which patch it needs, because a
  .rofl only runs on the build that produced it.
- **Everything on a server is visible to everybody on it.** Who has claimed
  which League account is not private here. Editing is what ownership gates.
- **Managing who is on the server.** An admin can see everybody, make somebody
  an admin or stop, disable an account without deleting anything, and remove one
  outright. Changing a role or disabling somebody ends their sessions, so it
  takes effect immediately rather than whenever their token next renews.
  Nothing here will leave the server with no administrator — there is no way
  back from that except editing configuration and restarting.
- **A version handshake.** `GET /version` answers without authentication and
  without a client version, so an out-of-date desktop can be told "this server
  needs Foxfire 0.12" on the connect screen rather than failing after somebody
  types a password. Builds this server does not speak to are refused with 426;
  builds that are behind but still supported are served, with a header saying
  there is something newer. That grace window matters while the desktop has no
  auto-update: without it, upgrading a server cuts off every friend at once.
- **Docker Compose.** The server, SQL Server and Azurite, driven by a `.env`.
  Copy `.env.example`, fill it in, `docker compose up`. SQL Server Express is
  the default edition — free to run for real, and 10 GB is a great deal of
  League history when matches are stored once and shared.

### Under the hood

- **The Riot rate limiter, ported from the desktop** and given priority classes.
  One personal key is roughly a hundred requests every two minutes for the
  *whole server*, so first-come-first-served stopped being fair: a friend's
  hours-long backfill would sit in front of somebody watching a spinner. Work is
  now classed interactive, post-game, or backfill, still strictly FIFO within a
  class. It is also locked, because ASP.NET calls it from many threads where
  Node's event loop did not.
- **One correction to that port.** The desktop computes its burst wait from the
  oldest surviving timestamp rather than the oldest inside the burst window,
  which after a pause goes negative, clamps to zero, and lets one request over
  the limit through. Nobody noticed because one person browsing never fills a
  burst window; a backfill on a shared key fills one every second, and the cost
  of being wrong is a rate-limit response that pauses the queue for everybody.
- **Config is checked all at once, before anything starts.** Missing settings
  are reported as one list rather than one at a time, so standing a server up
  does not mean restarting a container five times to discover five problems.
- **Secrets are environment configuration, full stop.** No encrypted column, no
  Data Protection key ring, no volume to forget to mount and silently sign
  everybody out with. The cost is that rotating the Riot API key means an edit
  and a restart, which is the trade taken deliberately.
- **Refresh tokens rotate and are stored only as hashes.** Redeeming one mints
  its replacement and marks it spent, so presenting an already-spent token means
  a copy is in use somewhere — and the whole chain is cut rather than the replay
  merely failing.
- **The import needs no session and no state.** The record that makes it translatable is the same
  retired-id row a key rotation leaves behind, because it is the same event — an id that used to
  mean an account and no longer does. So an import interrupted by a failure or a restart is
  resumed by running it again, and every batch skips what has already landed.
- **No replay ever passes through the server.** The desktop claims a match,
  gets a signed URL good for fifteen minutes, and puts the bytes straight into
  the blob store; a 30 MB file through a homelab's API process would be its
  upstream spent twice and a request held open for the length of an upload. The
  server then asks the store how big the blob actually is, because the desktop
  saying it finished is not evidence — an interrupted upload leaves a short
  blob, and a short blob offered to somebody else fails only after they have
  waited for it.
- **Claiming a replay is first-come and expires.** Nine of the ten people in a
  game have the same file and will all offer it; one wins and the rest are told
  it is covered. A claim that never completes goes stale after half an hour, so
  somebody closing their laptop mid-upload does not lock the game out forever.
- **A storage cap for replays, off by default.** A host can say how much of the blob store
  replays may take, and a claim past it is refused before any bytes move — so a refused replay
  costs a request rather than thirty megabytes of somebody's upstream. Off by default because a cap
  nobody chose is a cap that surprises somebody, and what it prevents is an upload being refused,
  which is exactly what it does.
- **Blob storage is optional**, and the server says so at startup when it is
  absent. Everything that is not a replay works without it.
- **SMTP is optional**, and the server says so at startup when it is absent.
  Homelab mail without a relay fails silently, so nothing is allowed to depend
  on it: every link the server would send is also copyable from the admin
  section.
- **The schema for match history**: matches, participants, rank readings,
  attributed LP, mastery, league entries, sync progress and retired puuids, with
  the indexes ported from the desktop rather than guessed at — each of those was
  added there against a query observed to be doing something worse. Matches are
  stored once and shared by everybody in them, which is what makes a community's
  storage sublinear in its size.
- **The whole match payload is kept as Riot sent it.** Three of the desktop's
  migrations add a projected column and backfill it out of the stored payload
  with no Riot calls at all; on a server sharing one personal key the
  alternative is not slower, it is days.
- **A rank reading's key is an identity column rather than a Guid.** Attribution
  walks adjacent pairs, so two readings sharing a millisecond have to come back
  in the same order every time — and SQL Server neither sorts stably nor orders
  uniqueidentifier by its bytes, so a Guid tiebreak would have been arbitrary
  *and* liable to differ between runs.
- **The server repairs itself after a key rotation.** Riot encrypts a player id
  against the key that asked for it, so replacing the key kills every id the
  server has ever stored. When Riot refuses one, the account is re-resolved from
  its Riot ID — the one handle a key change cannot invalidate — and its history,
  including the copy inside the stored payload, is rewritten onto the new id in
  one transaction. Lazily, when a request is actually refused: a sweep at
  startup would spend a request per account on every boot to discover, nearly
  always, that nothing had changed.
- **A sync runs on its own scope and is joined rather than repeated.** It
  outlives the request that asked for it, because a backfill is minutes; and a
  second caller for an account already syncing gets the first run's result
  instead of spending the community's budget proving the same thing twice.
- **A backfill is background work however it was triggered.** Two hundred
  requests is the whole server's allowance for four minutes, so nobody else's
  search waits behind somebody linking an account.
- **SignalR carries the events the desktop used to raise for itself**, on the
  same channel names, so nothing above the transport knows which one delivered
  them.
- **The LP attribution rule is ported to C# and pinned to the desktop's.** Both
  now compute the figure on a match row, and `fixtures/ladder-corpus.json` —
  generated by running the TypeScript over ten thousand inputs — is asserted by
  both suites, so either drifting fails immediately. It caught one real
  divergence before it shipped: JavaScript breaks a rounding tie upward and .NET
  breaks it to even, which would have disagreed on every LP value exactly half a
  division from where somebody started.
- **Releases.** `server-v*` tags build self-contained `linux-x64` and
  `win-x64` archives and a container image on GHCR, and the Release stays an
  invisible draft until its downloads have been read back at the size that was
  built — the same guarantee the desktop's workflow gives. The test suite runs
  first, including the ones that stand a real SQL Server up, so a release cannot
  go out on a schema that does not migrate.
- The replay tests run against Azurite in a container rather than a fake. A SAS
  is a signature over a container name, a blob name, a permission set and a
  validity window, and every one of them is a way to mint a URL that looks right
  and is refused — so the tests upload through the URL the server handed out and
  read the bytes back through another.
- Tests: 108 over the pure rules — invite tokens, the version allow list, the
  ladder corpus, what a sync decides to fetch — 17 over the rate limiter against
  a fake clock, including the burst-window case the desktop gets wrong, and 69
  against a real SQL Server in a container. The database ones earned their keep
  twice: the account-deletion path has to clear an invite's redeemer by hand,
  because SQL Server refuses two cascading paths between the same two tables;
  and the sync suite runs the real engine with only the socket replaced, so
  ingestion, deduplication and re-keying are asserted against the schema that
  actually enforces them.

[0.2.1]: https://github.com/xalluna/foxfire/compare/server-v0.2.0...server-v0.2.1
[0.2.0]: https://github.com/xalluna/foxfire/compare/server-v0.1.0...server-v0.2.0
[0.1.0]: https://github.com/xalluna/foxfire/releases/tag/server-v0.1.0
