# Foxfire Server changelog

The record of what the server shipped when, kept separately from the desktop's
`apps/desktop/CHANGELOG.md` because the two release on their own tags and their
own schedules — `server-v*` here, `v*` there.

The same doctrine applies: any PR that bumps `VersionPrefix` in
`apps/server/Directory.Build.props` adds that version's section in the same
commit, and there is no `[Unreleased]` section.

## [0.1.0] — 2026-09-17

The first thing that runs. You can stand a server up, register on it, sign in,
and say which League accounts are yours. Nothing fetches match history yet —
that is the next piece of work — so this is a foundation rather than something
worth pointing a community at.

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
- **SMTP is optional**, and the server says so at startup when it is absent.
  Homelab mail without a relay fails silently, so nothing is allowed to depend
  on it: every link the server would send is also copyable from the admin
  section.
- **Releases.** `server-v*` tags build self-contained `linux-x64` and
  `win-x64` archives and a container image on GHCR, and the Release stays an
  invisible draft until its downloads have been read back at the size that was
  built — the same guarantee the desktop's workflow gives. The test suite runs
  first, including the ones that stand a real SQL Server up, so a release cannot
  go out on a schema that does not migrate.
- Tests: 40 over the invite tokens and the version allow list, 17 over the rate
  limiter against a fake clock — including the burst-window case the desktop
  gets wrong — and 49 contract tests driving the HTTP surface against a real
  SQL Server in a container. Those last ones earned their keep immediately: the
  account-deletion path has to clear an invite's redeemer by hand, because SQL
  Server refuses two cascading paths between the same two tables and the
  database would otherwise refuse the delete.

[0.1.0]: https://github.com/xalluna/foxfire/releases/tag/server-v0.1.0
