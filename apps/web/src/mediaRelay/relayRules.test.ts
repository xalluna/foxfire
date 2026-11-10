import { describe, expect, it } from 'vitest'
import { embedFromHash, isPlayerMessage, routeMessage } from './relayRules'

describe('embedFromHash', () => {
  it('reads an embed URL the desktop put in the fragment', () => {
    const embed = 'https://media.example.com/embed/v1.abc?controls=0'
    expect(embedFromHash(`#${encodeURIComponent(embed)}`)).toBe(embed)
  })

  it('takes nothing but an http(s) URL', () => {
    expect(embedFromHash('')).toBeNull()
    expect(embedFromHash('#')).toBeNull()
    expect(embedFromHash(`#${encodeURIComponent('javascript:alert(1)')}`)).toBeNull()
    expect(embedFromHash(`#${encodeURIComponent('file:///C:/x.html')}`)).toBeNull()
    expect(embedFromHash('#not a url')).toBeNull()
    expect(embedFromHash('#%E0%A4%A')).toBeNull()
  })
})

describe('isPlayerMessage', () => {
  it('knows Foxfire Media’s messages and nothing else', () => {
    expect(isPlayerMessage({ foxfire: 1, type: 'hello' })).toBe(true)
    expect(isPlayerMessage({ foxfire: 1, type: 'command', id: 1, command: 'play' })).toBe(true)
    expect(isPlayerMessage({ foxfire: 1, type: 'event', event: 'timeupdate' })).toBe(true)
    expect(isPlayerMessage({ foxfire: 2, type: 'hello' })).toBe(false)
    expect(isPlayerMessage({ type: 'hello' })).toBe(false)
    expect(isPlayerMessage({ foxfire: 1, type: 'navigate' })).toBe(false)
    expect(isPlayerMessage('hello')).toBe(false)
    expect(isPlayerMessage(null)).toBe(false)
  })
})

describe('routeMessage', () => {
  const parent = { name: 'parent' }
  const player = { name: 'player' }
  const frames = { parent, player, playerOrigin: 'https://media.example.com' }
  const hello = { foxfire: 1, type: 'hello' }

  it('carries the parent’s commands down and the player’s answers up', () => {
    expect(routeMessage({ source: parent, origin: 'null', data: hello }, frames)).toBe('toPlayer')
    expect(
      routeMessage({ source: player, origin: 'https://media.example.com', data: { foxfire: 1, type: 'connected' } }, frames)
    ).toBe('toParent')
  })

  it('carries nothing from anybody else, or from the player at another origin', () => {
    expect(routeMessage({ source: { name: 'stranger' }, origin: 'https://evil.example', data: hello }, frames)).toBeNull()
    expect(
      routeMessage({ source: player, origin: 'https://evil.example', data: { foxfire: 1, type: 'event' } }, frames)
    ).toBeNull()
    expect(routeMessage({ source: parent, origin: 'null', data: { anything: true } }, frames)).toBeNull()
  })
})
