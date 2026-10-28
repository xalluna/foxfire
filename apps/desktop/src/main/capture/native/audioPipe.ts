import { createServer, type Socket } from 'node:net'

/**
 * A Windows named pipe that carries one recording's audio to FFmpeg.
 *
 * Not FFmpeg's stdin, which is kept for the one thing only stdin can do: take
 * the q that stops FFmpeg cleanly. With the audio on stdin, the only way to
 * stop was to end the audio and have `-shortest` end the video with it.
 *
 * This end is the pipe's server; FFmpeg opens it like a file and is the one
 * client. Samples written before FFmpeg connects are dropped: it connects as it
 * opens its inputs, before the first frame, and nothing before that is in the
 * recording anyway. Closing it is the audio's end, which FFmpeg has to see
 * before it can act on a q.
 */
export interface AudioPipe {
  /** The path FFmpeg opens, e.g. \\.\pipe\foxfire-audio-1234-1793149215569. */
  path: string
  write(samples: Buffer): void
  close(): void
}

export function openAudioPipe(name: string): AudioPipe {
  const path = `\\\\.\\pipe\\${name}`
  let client: Socket | null = null
  let closed = false

  const server = createServer((socket) => {
    if (closed || client) {
      socket.destroy()
      return
    }
    client = socket
    // FFmpeg going away mid-write is the end of the recording, which the
    // process's own exit reports.
    socket.on('error', () => undefined)
  })
  server.on('error', () => undefined)
  server.listen(path)

  return {
    path,
    write(samples) {
      if (client && !client.destroyed) client.write(samples)
    },
    close() {
      if (closed) return
      closed = true
      client?.end()
      server.close()
    }
  }
}
