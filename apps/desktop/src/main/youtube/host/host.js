/* global YT */
/**
 * YouTube's player, inside the page the desktop keeps apart for it.
 *
 * Plain JavaScript, served as-is by hostProtocol.ts: this runs on its own
 * origin with no bundler and no preload, and it is small on purpose — it
 * turns the recording window's play, pause and seek into the IFrame API's
 * calls, and reports the player's state back. Everything else about a
 * recording lives in the window that frames this.
 *
 * Commands are taken only from the window that framed this page. State is
 * posted to it with '*' because that window is a file:// page in a packaged
 * build, whose origin is opaque and cannot be named; what is sent is where a
 * video is up to, which is nobody's secret.
 */
;(function () {
  'use strict'

  var TYPE = 'foxfire-yt'
  var PLAYING = 1
  var POLL_MS = 250

  var videoId = new URLSearchParams(location.search).get('v') || ''
  var snapshot = { type: TYPE, ready: false, playing: false, currentTime: 0, duration: 0, errorCode: null }
  var player = null
  var poll = null

  function post() {
    window.parent.postMessage(snapshot, '*')
  }

  function update(patch) {
    for (var key in patch) snapshot[key] = patch[key]
    post()
  }

  function readTime() {
    if (!player) return
    update({ currentTime: player.getCurrentTime(), duration: player.getDuration() || snapshot.duration })
  }

  function stopPolling() {
    if (poll !== null) clearInterval(poll)
    poll = null
  }

  // The same check the server makes, so a crafted address cannot put
  // anything else into the embed URL.
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    update({ errorCode: 2 })
    return
  }

  // The frame is made here rather than by the API so its address and its
  // referrer policy are ours to set. The privacy-enhanced host, like the web.
  var iframe = document.createElement('iframe')
  var params = new URLSearchParams({ enablejsapi: '1', origin: location.origin, playsinline: '1', rel: '0' })
  iframe.src = 'https://www.youtube-nocookie.com/embed/' + videoId + '?' + params.toString()
  iframe.title = 'Recording on YouTube'
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  iframe.referrerPolicy = 'strict-origin-when-cross-origin'
  document.getElementById('player').appendChild(iframe)

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player(iframe, {
      events: {
        onReady: function () {
          update({ ready: true, duration: player.getDuration() })
        },
        onStateChange: function (event) {
          var playing = event.data === PLAYING
          update({ playing: playing })
          readTime()
          stopPolling()
          if (playing) poll = setInterval(readTime, POLL_MS)
        },
        onError: function (event) {
          stopPolling()
          update({ playing: false, errorCode: event.data })
        }
      }
    })
  }

  var script = document.createElement('script')
  script.src = 'https://www.youtube.com/iframe_api'
  script.onerror = function () {
    // Offline, or YouTube blocked. 5 is the API's "cannot play here".
    update({ errorCode: 5 })
  }
  document.head.appendChild(script)

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    var data = event.data
    if (!data || data.type !== TYPE || !player) return

    if (data.cmd === 'play') player.playVideo()
    else if (data.cmd === 'pause') player.pauseVideo()
    else if (data.cmd === 'seek' && typeof data.seconds === 'number' && isFinite(data.seconds)) {
      player.seekTo(Math.max(0, data.seconds), true)
      update({ currentTime: Math.max(0, data.seconds) })
    }
  })

  post()
})()
