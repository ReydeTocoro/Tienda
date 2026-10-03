import type { ReactNode } from 'react'

const TONE = {
  neutral: 'border-br2 bg-s2 text-txt2',
  red: 'border-red/30 bg-red/10 text-red',
  orange: 'border-orange/30 bg-orange/10 text-orange',
  green: 'border-green/30 bg-green/10 text-green',
  lime: 'border-lime/30 bg-lime/10 text-lime',
  blue: 'border-blue/30 bg-blue/10 text-blue',
}

/** Small count/total pill in the title row of the spreadsheet-style pages. */
export function Chip({ tone = 'neutral', children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`rounded-full border px-2.5 py-0.5 ${TONE[tone]}`}>{children}</span>
}
