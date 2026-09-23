/**
 * @foxfire/core/youtube — the parts of putting a recording on YouTube that
 * every client agrees on: reading a pasted link, naming and describing the
 * video, and saying why the embedded player will not play.
 *
 * Talking to YouTube is not here. Uploading needs the file and the Google
 * sign-in, both of which only the desktop has.
 */
export * from './videoId'
export * from './templates'
