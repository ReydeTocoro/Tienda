import { useLayoutEffect, type RefObject } from 'react'

/** By default content may shrink by at most this factor (text stays readable); anything taller scrolls. */
const MIN_ZOOM = 0.8

/** Shrinks a dialog's content just enough to fit the screen's height, so a short screen shows a whole
 * form instead of a scrollbar. Only slightly-too-tall content is shrunk: a long list (invoices, order
 * lines) keeps its normal size and scrolls inside the dialog. `body` is the single wrapper around
 * everything the dialog shows; `dialog` supplies the room (its max-height, or its own height).
 * `minZoom` lowers the floor for a dialog that cannot scroll at all (the PIN pad). */
export function useFitHeight(dialog: RefObject<HTMLElement | null>, body: RefObject<HTMLElement | null>, active: boolean, minZoom = MIN_ZOOM) {
  useLayoutEffect(() => {
    const d = dialog.current
    const b = body.current
    if (!active || !d || !b) return

    const fit = () => {
      b.style.setProperty('zoom', '1')
      const cs = getComputedStyle(d)
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
      const max = parseFloat(cs.maxHeight) // "none" for a dialog that is exactly as tall as the screen
      const room = (Number.isFinite(max) ? max - pad - border : d.clientHeight - pad) - 1
      const need = b.offsetHeight
      if (need <= room) return
      let zoom = Math.floor((room / need) * 1000) / 1000
      if (zoom < minZoom) return // too tall to shrink without turning unreadable: scroll instead
      b.style.setProperty('zoom', String(zoom))
      // Fractional layout can still leave a pixel or two over: nudge down until the scrollbar is gone.
      for (let i = 0; i < 5 && zoom > minZoom && d.scrollHeight > d.clientHeight; i++) {
        zoom = Math.max(minZoom, zoom - 0.01)
        b.style.setProperty('zoom', String(zoom))
      }
    }

    let frameId = 0
    const schedule = () => {
      cancelAnimationFrame(frameId)
      frameId = requestAnimationFrame(fit)
    }
    fit()
    const observer = new ResizeObserver(schedule)
    observer.observe(b)
    addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frameId)
      observer.disconnect()
      removeEventListener('resize', schedule)
      b.style.removeProperty('zoom')
    }
  }, [dialog, body, active, minZoom])
}
