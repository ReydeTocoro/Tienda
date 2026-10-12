import type { ReactNode } from 'react'

/** The text with every occurrence of `query` marked in yellow (capitals don't matter): for a list that is being
 * filtered by what is typed, so the eye finds the word in each row. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  const lower = text.toLowerCase()
  // A few letters change length when lowercased: then the positions don't line up and the text goes unmarked.
  if (!q || lower.length !== text.length || !lower.includes(q)) return <>{text}</>
  const parts: ReactNode[] = []
  let from = 0
  for (let at = lower.indexOf(q); at !== -1; at = lower.indexOf(q, from)) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="rounded-[3px] bg-yellow px-px text-on-yellow">
        {text.slice(at, at + q.length)}
      </mark>,
    )
    from = at + q.length
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}
