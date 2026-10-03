import { Plus } from 'lucide-react'

interface AddFabProps {
  /** Tooltip and accessible name, e.g. "Agregar cliente". */
  label: string
  onClick: () => void
}

/** Floating "+" in the corner of a spreadsheet-style page — opens that page's creation form.
 * Positions against the page's `relative` container. */
export function AddFab({ label, onClick }: AddFabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="absolute bottom-5 right-5 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-lime text-on-solid shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-6 md:right-6"
    >
      <Plus size={26} strokeWidth={2.5} />
    </button>
  )
}
