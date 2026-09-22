/**
 * Enough Markdown to read a changelog section, and not one line more.
 *
 * The patch notes travel with the update — the release page they were written
 * for belongs to a repository nobody is expected to read — so they arrive here
 * as the Markdown that was typed into CHANGELOG.md. Rendering them means
 * understanding exactly what CLAUDE.md says that file may contain: a sentence
 * or two of prose, `###` group headings, and bullets that wrap across lines
 * with **bold** leads and the odd `code` span.
 *
 * A parser for that is thirty lines. A Markdown library is a dependency in the
 * renderer, a bundle, and a standing invitation to paste arbitrary HTML into
 * the app from a file the build pipeline writes. Anything this does not know
 * how to read comes out as the text it is, which is the right failure: notes
 * that look slightly plain still say what changed.
 */

export type NoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }

/** Inline runs within a block. Everything unrecognised stays `text`. */
export type NoteSpan = { kind: 'text' | 'strong' | 'code'; text: string }

export function parseNotes(notes: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let paragraph: string[] = []
  let items: string[] = []

  const flush = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
    if (items.length > 0) {
      blocks.push({ kind: 'list', items })
      items = []
    }
  }

  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim()

    if (line === '') {
      flush()
      continue
    }

    if (line.startsWith('#')) {
      flush()
      blocks.push({ kind: 'heading', text: line.replace(/^#+\s*/, '') })
      continue
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (paragraph.length > 0) flush()
      items.push(line.slice(2).trim())
      continue
    }

    // Anything else continues whatever is open. Both bullets and prose are
    // wrapped at the file's column width, so a line on its own is almost
    // always the rest of the sentence above it.
    if (items.length > 0) items[items.length - 1] += ` ${line}`
    else paragraph.push(line)
  }

  flush()
  return blocks
}

export function parseSpans(text: string): NoteSpan[] {
  const spans: NoteSpan[] = []

  for (const piece of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (piece === '') continue

    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      spans.push({ kind: 'strong', text: piece.slice(2, -2) })
    } else if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
      spans.push({ kind: 'code', text: piece.slice(1, -1) })
    } else {
      spans.push({ kind: 'text', text: piece })
    }
  }

  return spans
}
