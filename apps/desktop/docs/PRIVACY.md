# Foxfire privacy policy

_Last updated 10 November 2026._

Foxfire is a desktop app that tracks your League of Legends and Teamfight Tactics games, records
them, and — if you choose — sends those recordings to a Foxfire Server so the people on it can
watch them. It is open source; everything below can be checked against the code in this repository.

There is no Foxfire company server. The developer does not run a service that receives your data.
What leaves your PC goes to Riot, or to a **Foxfire Server** — and the video storage beside it — that
you or somebody you know chose to run for a group of friends. Never to the developer.

## What stays on your PC

- Your match history, rank history and settings, in a local database under
  `%APPDATA%\Foxfire`.
- Your recordings, in the folder you choose (Videos\Foxfire by default), and the kill, death and
  assist markers Foxfire captures while you play.
- Secrets — your Riot API key, your OBS password, your Foxfire Server sign-in, and the one-time
  token each upload runs on — encrypted with Windows' own data protection, in
  `%APPDATA%\Foxfire\secure`.

## Recordings on a Foxfire Server

Sending recordings is optional and needs a Foxfire Server whose host has set up recordings. Nothing
goes until you upload one, select a batch, or turn on Settings › Server recordings › Upload every
game automatically.

**What is sent.** The recording's video file, to the server's video storage (Foxfire Media), which
its host runs. It goes there directly from your PC; the Foxfire Server itself only says that it may.
With it, to the Foxfire Server: the game it is of, your League account on that server, a title made
from your template, how long it runs, and the game's kill, death and assist markers.

**Who can see it.** Everybody signed in to that server, from your match history. Not visitors to a
server open without signing in, and not somebody you shared a profile link with.

**What stays.** By default, your file stays on your PC. If you choose to delete files after upload,
Foxfire deletes each one only once the server says its copy is ready to watch, and from then on the
server's copy is the only one.

## Taking it back

- **Cancel** on an upload in Captures › Recordings stops it; whatever had arrived is discarded by
  the server.
- **Remove recording from server**, on a match's right-click menu, takes a recording off your
  Foxfire Server and deletes its video from the server's storage. An admin of that server can do the
  same.
- **Forget**, in Captures › Recordings, removes a recording and its markers from your PC. A copy on
  the server stays until it is removed there.
- Anything else a server keeps is its host's: ask them.

## Questions

Open an issue at <https://github.com/xalluna/foxfire/issues>.
