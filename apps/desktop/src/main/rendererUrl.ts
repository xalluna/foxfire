import { join } from 'path'
import { pathToFileURL } from 'url'
import type { BrowserWindow } from 'electron'
import { is } from './lib/env'

/**
 * The address of a renderer route, for a window to load.
 *
 * Every window loads the one renderer bundle, and the renderer's router picks
 * what to draw from the hash — `#/telemetry`, `#/lp-editor?account=…`. In dev
 * that bundle is served by Vite; packaged, it is index.html on disk.
 *
 * The file URL is built by hand rather than through loadFile's `hash` option,
 * which runs the hash through url.format and mangles the `?`, `&` and `=` a
 * route's search carries.
 */
export function rendererUrl(route: string, devServer: string | undefined): string {
  const base = devServer ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
  return `${base}#${route}`
}

/** Load a renderer route into a window — see renderer/src/router.tsx for the routes. */
export function loadRoute(window: BrowserWindow, route: string): void {
  const devServer = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  void window.loadURL(rendererUrl(route, devServer))
}
