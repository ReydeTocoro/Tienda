import { useLayoutEffect, useState, type RefObject } from 'react'

/** Opens or closes a native `<dialog>` as `open` changes and says when its content may mount.
 *
 * The content has to mount *after* `showModal()`: a field's `autoFocus` focuses the field as it
 * mounts, and inside a dialog that isn't showing yet that does nothing — the dialog then focuses
 * its first button instead, so whoever types has to click the field first. Doing it in a layout
 * effect makes the second render happen before the browser paints, so nothing flashes. */
export function useShowDialog(dialog: RefObject<HTMLDialogElement | null>, open: boolean): boolean {
  const [shown, setShown] = useState(false)

  useLayoutEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
    setShown(open)
  }, [dialog, open])

  return open && shown
}
