import { describe, expect, it } from 'vitest'
import { parseNotes, parseSpans } from './changelogBlocks'

// A section shaped exactly like the ones CHANGELOG.md carries, wrapping and
// all — the notes arrive as the file was written, not reflowed.
const SECTION = `Foxfire now updates itself.

### Added

- **Updates install themselves.** Foxfire checks for a new build, downloads it
  quietly and offers to restart.
- Patch notes travel with the update.

### Fixed

- A startup launch no longer steals focus.`

describe('parseNotes', () => {
  it('reads a changelog section into its blocks', () => {
    expect(parseNotes(SECTION)).toEqual([
      { kind: 'paragraph', text: 'Foxfire now updates itself.' },
      { kind: 'heading', text: 'Added' },
      {
        kind: 'list',
        items: [
          '**Updates install themselves.** Foxfire checks for a new build, downloads it quietly and offers to restart.',
          'Patch notes travel with the update.'
        ]
      },
      { kind: 'heading', text: 'Fixed' },
      { kind: 'list', items: ['A startup launch no longer steals focus.'] }
    ])
  })

  it('joins a wrapped paragraph back into a sentence', () => {
    expect(parseNotes('One or two sentences on\nwhat this release is.')).toEqual([
      { kind: 'paragraph', text: 'One or two sentences on what this release is.' }
    ])
  })

  it('has nothing to say about nothing', () => {
    expect(parseNotes('')).toEqual([])
    expect(parseNotes('\n\n  \n')).toEqual([])
  })
})

describe('parseSpans', () => {
  it('pulls out the bold lead a bullet starts with', () => {
    expect(parseSpans('**Updates install themselves.** And then some.')).toEqual([
      { kind: 'strong', text: 'Updates install themselves.' },
      { kind: 'text', text: ' And then some.' }
    ])
  })

  it('reads a code span', () => {
    expect(parseSpans('reads `latest.yml` now')).toEqual([
      { kind: 'text', text: 'reads ' },
      { kind: 'code', text: 'latest.yml' },
      { kind: 'text', text: ' now' }
    ])
  })

  it('leaves anything it does not recognise as the text it is', () => {
    expect(parseSpans('a * lone star and ** empty bold')).toEqual([
      { kind: 'text', text: 'a * lone star and ** empty bold' }
    ])
  })
})
