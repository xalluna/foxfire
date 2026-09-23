import { parseNotes, parseSpans } from './changelogBlocks'

/**
 * A version's patch notes, as they were written in CHANGELOG.md.
 *
 * Deliberately quiet: this sits inside a settings card and under a banner, and
 * the notes are prose about League, not a document. Headings are the same
 * lettering the rest of Settings uses for a group label rather than the size
 * they would be in a file.
 */
export function ChangelogNotes({ notes }: { notes: string }): JSX.Element {
  return (
    <div className="space-y-2">
      {parseNotes(notes).map((block, index) => {
        if (block.kind === 'heading') {
          return (
            <h4
              key={index}
              className="pt-1 text-2xs uppercase tracking-widest text-text-mute first:pt-0"
            >
              {block.text}
            </h4>
          )
        }

        if (block.kind === 'list') {
          return (
            <ul
              key={index}
              className="list-disc space-y-1 pl-4 text-sm leading-relaxed text-text-dim"
            >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} />
                </li>
              ))}
            </ul>
          )
        }

        return (
          <p key={index} className="text-sm leading-relaxed text-text-dim">
            <Inline text={block.text} />
          </p>
        )
      })}
    </div>
  )
}

function Inline({ text }: { text: string }): JSX.Element {
  return (
    <>
      {parseSpans(text).map((span, index) => {
        if (span.kind === 'strong') {
          return (
            <strong key={index} className="font-medium text-text">
              {span.text}
            </strong>
          )
        }

        if (span.kind === 'code') {
          return (
            <code key={index} className="rounded bg-surface px-1 font-mono text-2xs">
              {span.text}
            </code>
          )
        }

        return <span key={index}>{span.text}</span>
      })}
    </>
  )
}
