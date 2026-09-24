# Foxfire Server changelog

The record of what the server shipped when, kept separately from the desktop's
`apps/desktop/CHANGELOG.md` because the two release on their own tags and their
own schedules — `server-v*` here, `desktop-v*` there.

The web client has no changelog of its own: it ships inside the server, so what
changed in it is recorded here, in the release that carries it.

The same doctrine applies: any PR that bumps `VersionPrefix` in
`apps/server/Directory.Build.props` adds that version's section in the same
commit, and there is no `[Unreleased]` section.

## [0.4.0] — 2026-09-24

A server that answers what a screen asks rather than handing over every account
it has. Clients used to download the whole list of League accounts on the server
— at launch and on nearly every page — and search it themselves, which is fine
for a dozen people and not for a community that keeps growing. Now your own
accounts are a list, anybody else's is one lookup, and the finder answers a page
at a time. So does every other list that grows with the community or with time —
the members, used invites, the replay library and match history — each saying how
long it is. Serves Foxfire 0.15 and newer. In the browser, finding somebody moves
out of the Players page and into a search box on every page, which opens on the
players you starred, and a profile leads with a month of Solo/Duo and the
season's most-played champions.

### Added

- **A search box on every page.** The middle of the header finds anybody on the
  server, and Ctrl K (⌘K on a Mac) jumps to it. Click in it for your favorites
  and your own accounts; type three letters and it suggests up to ten players.
  Pick one, with the mouse or the arrow keys and Enter, to open their profile.
- **Favorites.** Star anybody — beside their name in the search box, or on their
  profile — and they are at the top of the box the next time you click in it,
  without waiting on the server. Up to ten, newest first, kept by this browser,
  and a favorite's rank catches up whenever the page sees that player again.
- **Set home from a profile.** A house beside Copy link makes this browser open
  on that player, and is filled in on the one it opens on already. It used to be
  the star on the Players page, which means favorite now.

### Changed

- **Rank and champions on the profile.** The Solo/Duo card shows how far through
  the tier somebody is, what the last 30 days did to their LP, and the month
  drawn beneath it — one point a day — with Rank history for the whole graph.
  Below Flex, the five champions they have played most this season, for all
  queues, Solo/Duo or Flex, and All champions for the rest. On a narrow screen
  or a phone the cards sit above the recent games at full size, rather than as
  chips beside the name. The Profile, Champions and Rank tabs stay.
- **A way back from Rank and Champions.** Both pages open with a link back to the
  player's profile.
- **"Over this period" counts from before the period.** On the Rank page, thirty
  days now includes the month's first game, and matches the profile's figure.
- **Closest names first.** A typed search answers an exact name or whole Riot ID
  first, then names that start with what was typed, then names that only contain
  it — alphabetical within each. A box that shows ten should show the closest
  ten, not the first ten A to Z. A blank search is still name order, and paging
  still never repeats or skips anybody.
- **Every search is capped.** A search that does not ask for a page gets fifty
  players, and none gets more than a hundred.
- **League accounts pages its claims.** An admin's list of claimed accounts
  arrives fifty at a time, with a box to find one by name, rather than every
  claim on the server at once.
- **Members searches the server.** The Members page finds somebody by name or
  email on the server rather than in a list it downloaded whole, fifty at a time
  with Show more, and says how many members there are — or how many match.
- **Invites shows what can still be used, and the rest a page at a time.** Open
  invites are listed in full; used ones arrive fifty at a time with Show more.
  The list used to stop at the newest two hundred invites ever made, so on a
  long-running server the oldest simply were not there. Withdrawn and lapsed
  invites are no longer sent at all, since nothing showed them.
- **The replay library pages.** Data & storage lists shared replays biggest
  first, fifty at a time with Show more, rather than stopping at the biggest
  fifty — so the one you came to delete is always reachable.
- **Foxfire 0.14 is no longer served.** Every list above now answers with a page
  and a count, which 0.14 cannot read: its Search, match history and admin pages
  would all come up empty. A 0.14 desktop connected here updates itself to 0.15,
  the version this release names. A browser tab left open across the upgrade is
  told to reload.
- **Nothing to open yet?** Signed in with no League account claimed, the front
  page says how to claim one and that everybody else is in the search box,
  rather than opening a list of everybody.

### Removed

- **The Players page.** Everything it did is in the header's search box, which
  works from whichever page you are on. An old `/players` link opens the front
  page.

### Under the hood

- Three reads replace the one that answered with every account:
  `GET /api/riot-accounts/mine` for the accounts you have claimed,
  `GET /api/riot-accounts/{id}`, and
  `GET /api/riot-accounts/lookup?gameName=…&tagLine=…`, which a player's link
  and the League client's signed-in account are both matched by. The lookup is
  answered by the unique index on the Riot ID, in any capitalisation.
- `/api/search` takes `limit` and `offset`, and `mine` and `claimed` to narrow it.
  A blank search pages through the Riot ID index in name order instead of sorting
  the table. A typed one is ordered by how close each name is, with name, tag and
  id still breaking ties so a page boundary falls in the same place every time;
  a test covers the order.
- The web client keeps its favorites in local storage beside the home account,
  each a copy of the player as last seen, so the list draws without a request.
  The rules — ten at most, newest first, one per account, and a copy replaced
  only by a newer one — are shared with the desktop and tested.
- `GET /api/riot-accounts`, every account at once, is deprecated. It still
  answers for Foxfire 0.14, which reads nothing else, but says so with a
  `Deprecation` header (RFC 9745), and is marked obsolete in the code so nothing
  new calls it. It goes in the release that takes 0.14 off the allow list.
- Every list that grows answers `{ items, total }` rather than an array:
  `/api/search`, `/api/riot-accounts/{id}/matches`, `/api/admin/users` (which
  now takes `q`, `limit` and `offset`), `/api/admin/invites/used` (new) and
  `/api/admin/storage/replays` (which now takes `offset`, and answers at most a
  hundred rather than two hundred). `GET /api/admin/invites/` answers with the
  open invites only. Each is counted over the same filters it pages, in an order
  that ends in a unique column so no row falls between two pages.
- API version 3, and the web client is built against it. Admitting 0.15 and
  taking 0.14 off the allow list — with the deprecated `GET /api/riot-accounts`
  going at the same time — happen in the commit that releases both.
- Rank history is deliberately still answered whole: the graph needs every
  reading in the range to draw its line, and the range is what bounds it. It
  also sends `before`, the last reading ahead of the range, which "over this
  period" counts from.
- `GET /api/riot-accounts/{id}/rank/trend?queueType=` is the profile's graph:
  thirty days as the last reading of each day, at most 31 points however much
  history there is, and the month's LP change counted from the raw readings.
  Two indexed reads — the reading before the window and everything since. New
  rather than changed, so the API version stays 3. The rule is the desktop's,
  ported, and `fixtures/rank-trend-corpus.json` — generated by running the
  TypeScript — holds the two to the same answers, as the ladder corpus does for
  LP.
- Tests for each read — including that "yours" never picks up an account nobody
  has claimed — and for paging, totals, the cap and both filters; for finding
  members by name or address; for which invites are open and the order used ones
  page in; for the replay library; and that every paged route answers with a
  page on the wire.

## [0.3.1] — 2026-09-23

A fix for the sync bar, which on a server never went away.

### Fixed

- **Syncing finishes.** After a sync, the "Syncing new matches" bar on an
  account's page stayed up for good — in the web client and in every desktop
  connected to a server — however long ago the sync had actually finished. The
  server was announcing the end of a sync in a spelling the clients did not
  recognise, so they went on waiting for it. Updating the server is the whole
  fix: nobody needs a new desktop for it.

### Under the hood

- A test now reads the sync progress event exactly as the server's live
  connection writes it, and names every phase it can be in, so a change on
  either side that the other does not expect fails here rather than on
  somebody's screen.

## [0.3.0] — 2026-09-23

Accounts you can look after, and a search that looks through the people on this
server rather than strangers on Riot. Everybody can change their own email,
password and name; an admin can hand somebody a reset link the way they hand out
invites, and can track a League account nobody here has claimed; and the pages
that run a server are split so that a community with forty people on it is still
readable. It also serves Foxfire 0.14.0, the first desktop that updates itself —
which makes the allow list here the thing that decides which build your members
are running. And the server now keeps its own logs, so that when something goes
wrong there is still a record of it after the container has been restarted.

### Added

- **A way back in.** An admin can make a password reset link for any member, on
  the Members page, and copy it wherever their community talks — this server
  sends no mail, so a link you can paste is the whole mechanism. It lasts 24
  hours, works once, and there is never more than one live per account: making a
  newer one withdraws the last. Making a link changes nothing until it is used,
  so somebody who remembers their password in the meantime is not locked out.
  Using it sets the new password, signs them in on that browser, and ends every
  session the account had.
- **Your own account, in the web client.** A new Account page — your name in the
  header opens it — for changing the address you sign in with, your password,
  and the name shown beside your games. Changing your email or your password
  asks for your current password, because a session is not proof of the person:
  somebody at an unlocked browser has one.
- **Changing your password signs out every other device**, and keeps the one you
  changed it on. If the old password had got out, nothing minted from it
  survives. The other devices ask for a password within a quarter of an hour,
  when their access token next needs renewing.
- **A confirm-password box** wherever a password is set: registering, taking an
  invite, changing it, and following a reset link.
- **Members and Invites are separate pages.** Members has a filter and one line
  per person, which opens for their League accounts, sessions, when they joined,
  and everything an admin can do to them. Invites keeps the public sign-up
  switch beside the invites it governs.
- **The sign-in page says what to do about a forgotten password**: ask this
  server's administrator for a reset link.
- **Serves Foxfire 0.14.0, and only that.** A desktop from 0.14.0 on reads
  `recommendedDesktop` from `/version` and installs that build, so the allow list
  here decides which version the people on your server are running. They move
  when you update the server, and not before — a desktop never updates past what
  its server will talk to. There is no grace window this time: search changed
  shape, so 0.12.0 and 0.13.0 are refused rather than nudged, and neither has an
  updater to carry itself across. Tell your members to install 0.14.0 by hand;
  it is the last time you will have to.
- **Tracked League accounts, added by an admin.** A League accounts page takes a Riot ID and starts tracking
  it — resolved through Riot as it is saved, so a name that does not exist is refused rather than
  filed, and backfilled straight away at the lowest priority. The account arrives claimed by nobody,
  the same state an imported one is in, and whoever it belongs to can still claim it from the
  desktop. There is no way to stop tracking one: matches are shared rows that other tracked players
  appear in, and what removing one should mean is a question for another release.
- **Logs that outlast the container.** Everything the server logs is kept in the blob store it
  already uses for replays, in a `logs` container of its own, one file an hour, for 30 days — so the
  record of what went wrong is still there after the restart that fixed it. Nothing to set up: under
  docker-compose that store is the Azurite beside it. `LOG_RETENTION_DAYS` changes how long,
  `LOG_CONNECTION_STRING` keeps them in a different storage account, and `LOG_LEVEL` how much.
- **Logs somewhere else, if you already have somewhere.** A file on a volume, an OpenTelemetry
  collector (and so Grafana, Datadog, Honeycomb or Azure Monitor), Seq or Application Insights —
  docker-compose.yml has a block for each to uncomment. `LOG_TO_BLOB=false` stops keeping them in the
  blob store as well, and `LOG_CONSOLE_FORMAT=json` is for a collector reading the container's output.
- **Every response carries an `X-Trace-Id`.** When somebody tells you something broke, that id finds
  the request in the logs, and every line the server wrote while handling it.
- **One log line per request**: what was asked for, by which client and version, which member, from
  what address, what it got back and how long it took. Never the query string, which is where the
  hub's access token travels.
- **Sign-ins are logged**: a sign-in, a wrong password, and an account locking itself after too many,
  along with every request turned away by a rate limit — the lines you want when you are wondering
  whether somebody has been guessing passwords.

### Changed

- **The address in `ADMIN_EMAIL` is now pinned to the account that holds it.**
  That account cannot change its email in the app, and nobody who is not already
  an admin can move onto that address. Registering with it grants the Admin role
  even on a server with sign-up shut, and it is re-granted on every boot, so
  leaving it unheld would leave a claim on the server lying around. To move it,
  change `ADMIN_EMAIL` and restart.
- **A revoked refresh token is refused rather than treated as a theft.** Only a
  token that was *rotated* and then presented again means a copy is in use
  somewhere, which is what the whole-account revocation is for. One revoked by
  signing out, by an admin, or by a password change has nothing continuing from
  it. This is what lets a password change keep the device that made it — and it
  also fixes signing back in after being demoted or disabled, where the first
  device to return could be cut again by a stale one.
- **Search finds the players this server tracks.** `GET /api/search` now takes `?q=` and answers out
  of the database — every tracked account for a blank query, and whatever matches a name, a tag or a
  whole Riot ID otherwise, each with its solo-queue rank. It used to resolve any Riot ID in the world
  through fourteen Riot requests and answer with ten games that could carry no LP, because nothing
  about a stranger is stored. In the browser this is the Players page, with a box at the top of it.
- **Any member can start a sync, once every two minutes per account.** It used to be the owner's
  alone. An account an admin tracks has no owner, nothing on this server syncs on a timer, and the
  post-game ladder is armed by a desktop watching a League client nobody is running for it — so
  owner-only meant its history froze on the day it arrived. The cooldown is read off the stored sync
  timestamps, so a restart does not reopen the Riot budget. Recording a rank reading and writing LP
  are still the owner's: those assert something about somebody's account rather than ask for what
  Riot has already published.
- **Importing a newer copy of a `stats.db` says what it did.** Keep using Foxfire on your own PC for
  a few days, choose the newer copy of the same file, and what lands is what is new — that was always
  so, but the result counted only what was added, so a server that already had everything and a file
  it could not read looked exactly alike. It now says what was added and what the server already
  had, the newest game and rank reading in the file, and anything it had to leave out and why.
- **A re-import sends only what is new.** The importer asks which of the file's games the server
  lacks and sends only those, and an account the server already knows is not looked up on Riot
  again — so bringing a server up to date costs a fraction of the first import.
- **Importing in the browser says to close Foxfire first.** A browser reads only the file you pick,
  not the changes Foxfire keeps beside it while it is running, so the newest games can be missing.
  The page says so before you start, and again beside the newest game in the file when an import
  adds nothing.

### Removed

- **The legacy root shim.** Desktop 0.12.0 called the API at the root, where the web client's pages
  are, and every such request was moved under `/api` before routing. 0.12.0 is off the allow list, so
  every desktop this server answers now asks for `/api` itself.

### Fixed

- **Games imported before their account could be resolved come back.** If Riot's key was down, or
  the account had been renamed, an import stored its games where nothing could find them, and every
  later import skipped them as already stored. The import that finally resolves the account now
  moves them onto it, and says how many it moved.
- **Choosing a file to import in the browser could do nothing at all.** The picker sometimes never
  reported the choice back.

### Under the hood

- One new table, `PasswordResets`, alongside `Invites` and built the same way: a
  signed token that names a row, and the row alone deciding whether it has been
  spent. The reset link signs with a key derived from `Auth__InviteSigningKey`
  rather than one of its own, so no existing server needs new configuration on
  upgrade, and neither kind of token can ever verify as the other. Each row keeps
  the account's security stamp, so a link goes dead the moment the account
  changes underneath it.
- `Auth__PasswordResetLifetime` sets how long a link lasts. It defaults to 24
  hours, where an invite gets 14 days: an invite makes an account, a reset link
  takes one over.
- Reset previews and redemptions are rate limited per address, unlike the invite
  preview beside them.
- Server releases are no longer marked as the repository's Latest release. That
  badge is what a browser lands on, and what the desktop's updater reads the
  newest desktop version from, so it belongs to the desktop installer. The
  container image is unaffected: `:latest` on GHCR still follows every server
  release.
- The per-address search limit went from 30 a minute to 120, and the finder waits
  a quarter-second after the last keystroke before asking. Thirty was sized for a
  search that cost fourteen Riot requests and was sent by pressing a button; this
  one reads the database and is sent by typing, and thirty would have run out
  inside a couple of names. `RATE_LIMIT_SEARCH_PER_MINUTE` still overrides it.
- The finder is one screen shared by the web client and the desktop, so the two cannot drift.
- Tests cover the new search against a real SQL Server — that a blank query includes unclaimed
  accounts, that a tag and a pasted `name#tag` both match, and that rank is joined on — along with
  adding a tracked account, refusing a duplicate, and the sync cooldown.
- `POST /api/admin/import/unstored-matches` takes a file's game ids and answers with the ones this
  server does not hold. It is additive, so the API version did not move. Import batches answer with
  what they took, what was already there and what they could not read, rather than a single count.
- Moving stranded games onto an account's resolved id is the same move a Riot key rotation already
  made, now one piece of code so the two cannot disagree. It happens in the transaction that records
  the account's id, so a crash cannot leave the mapping filed with the games still stranded; a game
  that already holds both ids is left alone and counted.
- Tests against a real SQL Server import a file, add a game, a reading and an account, and import
  again: only the new rows land, with LP worked out for the new game, a known account is not looked
  up on Riot again, and games stored under an id nothing matched are moved once it resolves.
- **Recordings on YouTube are in this build, switched off.** A desktop attaching the video it
  uploaded to its owner's game, every member watching it from that player's history — and only that
  player's — in the desktop or on a page of its own in the browser, and attaching a link by hand, are
  all written, and none of it is served until Foxfire's Google project has been through YouTube's
  review. Whether a build has it is decided when it is compiled, by the `FOXFIRE_FEATURE_YOUTUBE`
  repository variable, for the server and the web client inside it together; this release was made
  without it, so there are no recording routes, a match row's `recording` is always null, and the
  content security policy lets nothing of YouTube's in. What turning it on brings:
  - `GET`, `PUT` and `DELETE /api/riot-accounts/{id}/matches/{matchId}/recording`. Only the
    account's owner can attach — admins included in the refusal — and the owner or an admin can
    remove. A second attach answers 409 `recording_exists` unless it says `replace`.
  - A new hub event, `recording:changed`, carrying the account and the game, so the rows showing that
    player's view of that game refresh everywhere.
  - The web client's content security policy allows YouTube's privacy-enhanced player at
    `youtube-nocookie.com` in a frame, and YouTube's IFrame API script, which is what lets the
    markers seek the video. Nothing else from YouTube, and nothing drawn over its player.
  - Tests against a real SQL Server for owner-only attaching, the one-perspective rule on match rows,
    replacing, removing, validation and the event. CI builds and tests the server both ways.
- One new table, `MatchRecordings`, created whether or not a build serves recordings, so turning them
  on later needs no migration of its own. It is keyed on the game and the Riot account — the
  account's id rather than its puuid, which is re-resolved whenever the server's Riot key changes —
  and stores the YouTube video id and the markers as sent, never the video. Deleting a game takes its
  recordings with it.
- Logging goes through Serilog, behind the `ILogger` everything already wrote to. The blob lines are
  compact JSON with the message rendered and as its template, and the trace id on each. The sinks a
  host can name are listed in code rather than discovered, because the single-file release archives
  have no manifest for Serilog to search — and a sink it cannot find is skipped without a word. A test
  configures each one exactly as docker-compose.yml spells it.
- The health check, the handshake and the web client's own files log at Debug, since monitors and
  updaters ask for the first two on a timer. A failed request is an Error, a rate-limited one a
  Warning, and everything else Information.
- Every line written during a sync carries the account and what started it. The Riot request pump no
  longer inherits the context of whichever request first woke it, which would have put a long-finished
  request's trace id on every line it wrote afterwards.
- A database that cannot be reached or migrated at boot is logged as critical and flushed to the blob
  store before the process exits, rather than lost in the unsent batch.
- Old logs are cleared by a daily sweep, by age. The sink's own clean-up is left off: it lists the
  whole container after every batch and counts by file rather than by day.
- Serilog's own failures — a blob store that stops accepting writes — go to the console's error
  stream, where they would otherwise go nowhere.

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

[0.4.0]: https://github.com/xalluna/foxfire/compare/server-v0.3.1...server-v0.4.0
[0.3.1]: https://github.com/xalluna/foxfire/compare/server-v0.3.0...server-v0.3.1
[0.3.0]: https://github.com/xalluna/foxfire/compare/server-v0.2.0...server-v0.3.0
[0.2.0]: https://github.com/xalluna/foxfire/compare/server-v0.1.0...server-v0.2.0
[0.1.0]: https://github.com/xalluna/foxfire/releases/tag/server-v0.1.0
