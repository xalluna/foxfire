# Foxfire Server changelog

The record of what the server shipped when, kept separately from the desktop's
`apps/desktop/CHANGELOG.md` because the two release on their own tags and their
own schedules — `server-v*` here, `v*` there.

The same doctrine applies: any PR that bumps `VersionPrefix` in
`apps/server/Directory.Build.props` adds that version's section in the same
commit, and there is no `[Unreleased]` section.

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
- **Live progress.** A backfill of a few hundred games takes minutes on a shared
  key, so the desktop is told how far through it is as it goes.
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

[0.1.0]: https://github.com/xalluna/foxfire/releases/tag/server-v0.1.0
