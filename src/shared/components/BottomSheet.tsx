import type { ReactNode } from 'react'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxWidthClass?: string
  zIndexClass?: string
}

/** Bottom-anchored sliding sheet on mobile — replaces the legacy `.overlay > .sheet` pattern
 * used throughout (receipt, client form/profile/picker, extras, fiado detail, etc). On
 * desktop (`lg:` and up) this instead centers as a regular dialog, since a sheet that slides
 * up from the bottom of a 1440px-wide window reads as a mobile page stretched wide, not a
 * native desktop control. */
export function BottomSheet({ open, onClose, children, maxWidthClass = 'max-w-[520px]', zIndexClass = 'z-[400]' }: BottomSheetProps) {
  if (!open) return null
  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-end justify-center bg-black/80 lg:items-center lg:p-6`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto rounded-t-[22px] border border-br2 bg-s1 p-[18px] animate-[sheetUp_0.22s_ease] lg:rounded-[22px] lg:p-6 lg:animate-[dialogIn_0.18s_ease]`}
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-br2 lg:hidden" />
        {children}
      </div>
    </div>
  )
}
