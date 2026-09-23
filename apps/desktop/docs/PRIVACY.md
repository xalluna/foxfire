# Foxfire privacy policy

_Last updated 23 September 2026._

Foxfire is a desktop app that tracks your League of Legends games, records them through OBS, and —
if you choose — puts those recordings on your own YouTube channel. It is open source; everything
below can be checked against the code in this repository.

There is no Foxfire company server. The developer does not run a service that receives your data.
What leaves your PC goes to Riot, to Google, or to a **Foxfire Server** that you or somebody you
know chose to run for a group of friends — never to the developer.

## What stays on your PC

- Your match history, rank history and settings, in a local database under
  `%APPDATA%\Foxfire`.
- Your recordings, in the folder you choose (Videos\Foxfire by default), and the kill, death and
  assist markers Foxfire captures while you play.
- Secrets — your Riot API key, your OBS password, your Foxfire Server sign-in, and your Google
  sign-in — encrypted with Windows' own data protection, in `%APPDATA%\Foxfire\secure`.

## YouTube

Connecting YouTube is optional and off until you do it, in Settings › YouTube.

**What Foxfire asks Google for.** Permission to upload videos to your YouTube channel
(`youtube.upload`), and your Google account's email address, so Settings can show which account
uploads go to. Foxfire cannot read, change or delete anything already on your channel.

**What Foxfire keeps.** The email address, in the local database, and a Google refresh token,
encrypted as above. Neither is ever sent anywhere except back to Google.

**What goes to YouTube.** The recordings you upload — one at a time from the upload form, or
automatically if you turn that on — with the title, description and privacy setting you chose.
Google handles them under the [YouTube Terms of Service](https://www.youtube.com/t/terms) and the
[Google Privacy Policy](https://policies.google.com/privacy). By uploading through Foxfire you agree
to the YouTube Terms of Service.

**What goes to a Foxfire Server.** If you are connected to one, and the League account the game was
played on is yours there: the video's YouTube id, its title and privacy, how long it runs, and the
game's kill, death and assist markers. Everybody on that server can then watch it from your match
history. The video itself stays on YouTube.

## Taking it back

- **Disconnect** in Settings › YouTube stops all uploads and tells Google to revoke Foxfire's
  access. You can also revoke it yourself from your
  [Google account's permissions](https://myaccount.google.com/permissions).
- **Remove recording from server**, on a match's right-click menu, takes a recording off your Foxfire
  Server. The video stays on YouTube.
- **Forget**, in Captures › Recordings, removes a recording and its markers from your PC.
- Videos on YouTube are deleted on YouTube — Foxfire has no permission to delete them.

## Questions

Open an issue at <https://github.com/xalluna/foxfire/issues>.
