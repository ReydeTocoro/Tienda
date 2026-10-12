import type { ReactNode } from 'react'

/** The small rounded label of a table cell (status, payment terms). `cls` carries the colors. */
export function Pill({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${cls}`}>{children}</span>
}

const NEUTRAL = 'border-br2 text-txt2 hover:border-lime/40 hover:text-lime'
/** The row's main action: tinted, so it reads before the plain ones. */
export const PRIMARY = 'border-lime/40 bg-lime/10 text-lime hover:bg-lime/20'

interface RowButtonProps {
  title: string
  onClick: () => void
  /** Colors; the plain outline by default. */
  className?: string
  children: ReactNode
}

/** An icon button in the actions cell of a row. It stops the click, so it doesn't also open the row. */
export function RowButton({ title, onClick, className = NEUTRAL, children }: RowButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
      aria-label={title}
      className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${className}`}
    >
      {children}
    </button>
  )
}
