import { BrowserWindow } from 'electron'

/**
 * Sends one event to every open window.
 *
 * Main-process code almost never knows which window ought to hear about
 * something. A finished sync has to reach the dashboard, the rank graph and an
 * open LP editor; a recording being bound changes what two of them draw; the
 * window that triggered the work is usually not the window that has to react to
 * it. So events fan out to all of them and each renderer decides whether it
 * cares, which is both cheaper and less brittle than keeping a register of who
 * is interested in what.
 *
 * Every such send goes through here rather than reaching for BrowserWindow
 * where it happens. That is worth one indirection for two reasons. It keeps
 * `electron` out of the services, which are otherwise plain functions over a
 * database handle and are tested as such. And it leaves exactly one place that
 * turns "this happened" into "tell the windows" — which is the seam an event
 * arriving from somewhere other than this process has to come in through.
 */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args)
  }
}
