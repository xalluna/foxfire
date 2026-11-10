import { embedFromHash, routeMessage } from './relayRules'

/**
 * The relay page: one of Foxfire Media's players, framed full size, with its
 * messages carried to and from whoever framed this. See relayRules.ts for why.
 *
 * Styled through the DOM rather than a stylesheet: the page's CSP allows this
 * script and nothing inline, and four properties are not worth a file.
 */
function start(): void {
  const root = document.documentElement
  root.style.cssText = 'height:100%;margin:0;background:#000;overflow:hidden'
  document.body.style.cssText = 'height:100%;margin:0'

  const embedUrl = embedFromHash(window.location.hash)
  if (!embedUrl) return

  // Out of the address, now it has been read: nothing else on the page needs it.
  history.replaceState(null, '', window.location.pathname)

  const playerOrigin = new URL(embedUrl).origin
  const frame = document.createElement('iframe')
  frame.src = embedUrl
  frame.title = 'Recording'
  frame.allow = 'autoplay; fullscreen; picture-in-picture'
  frame.allowFullscreen = true
  frame.referrerPolicy = 'no-referrer'
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0'
  document.body.appendChild(frame)

  window.addEventListener('message', (event) => {
    const route = routeMessage(event, { parent: window.parent, player: frame.contentWindow, playerOrigin })

    if (route === 'toPlayer') {
      frame.contentWindow?.postMessage(event.data, playerOrigin)
    } else if (route === 'toParent') {
      // '*' because the parent is the desktop's file:// window, whose origin
      // is opaque and cannot be named. What goes up is the player's state —
      // where the playhead is, the volume — and nothing worth keeping from anybody.
      window.parent.postMessage(event.data, '*')
    }
  })
}

start()
