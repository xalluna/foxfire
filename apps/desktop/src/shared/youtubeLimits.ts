/**
 * YouTube caps a video at 15 minutes until its channel has verified a phone
 * number, and most games are longer. Shared because the upload form warns
 * about it before an upload and the queue explains it after one.
 */
export const UNVERIFIED_LIMIT_SECONDS = 15 * 60
