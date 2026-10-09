import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { useScannerStore } from '../../store/useScannerStore'
import { usePinStore } from '../../store/usePinStore'

const MIN_LEN = 4 // minimum chars to consider a barcode
const MAX_INTERVAL = 50 // ms max between keystrokes from a real scanner
const RESET_TIMEOUT = 300 // ms of silence before we give up on an in-progress sequence
const TERMINATORS = new Set(['Enter', 'Tab'])

function isTypingTarget(target: EventTarget | null, exceptEl?: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (exceptEl && target === exceptEl) return false
  const tag = target.tagName
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return type !== 'button' && type !== 'submit'
  }
  return target.isContentEditable
}

export interface UseHidScannerOptions {
  onScan: (code: string) => void
  /** An input that stays eligible for HID capture even while it holds focus (e.g. the search bar). */
  exceptRef?: RefObject<HTMLElement | null>
  enabled?: boolean
}

/** Keystroke-timing barcode detector for USB/HID "keyboard wedge" scanners — these type
 * characters faster than a human and terminate with Enter/Tab.
 * Ported from the legacy `HID` IIFE (index.html L1990-2278). */
export function useHidScanner({ onScan, exceptRef, enabled = true }: UseHidScannerOptions): void {
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const storeEnabled = useScannerStore((s) => s.enabled)
  const setLastCode = useScannerStore((s) => s.setLastCode)

  useEffect(() => {
    if (!enabled || !storeEnabled) return

    let buf = ''
    let active = false
    let lastTime = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    function reset() {
      buf = ''
      active = false
      clearTimeout(timer)
    }

    function process(code: string) {
      const trimmed = code.trim()
      reset()
      if (trimmed.length < MIN_LEN) return
      setLastCode(trimmed)
      onScanRef.current(trimmed)
    }

    function onKeydown(e: KeyboardEvent) {
      if (isTypingTarget(e.target, exceptRef?.current)) return
      // Digits typed into the PIN pad are a PIN, never a barcode — even when typed fast.
      if (usePinStore.getState().request) return

      const key = e.key
      const now = Date.now()

      if (TERMINATORS.has(key)) {
        if (active && buf.length >= MIN_LEN) {
          e.preventDefault()
          process(buf)
        } else {
          reset()
        }
        return
      }

      // Ignore modifier/functional keys (Shift, Alt, F1, ArrowLeft, ...) without breaking a sequence.
      if (key.length > 1) return

      const elapsed = now - lastTime
      lastTime = now

      if (active && elapsed > MAX_INTERVAL * 3) {
        // Too slow to be the scanner — this was a human typing; start a fresh sequence.
        reset()
      }

      buf += key
      active = true

      clearTimeout(timer)
      timer = setTimeout(() => {
        if (buf.length >= MIN_LEN) process(buf)
        else reset()
      }, RESET_TIMEOUT)
    }

    document.addEventListener('keydown', onKeydown, true)
    return () => {
      document.removeEventListener('keydown', onKeydown, true)
      clearTimeout(timer)
    }
  }, [enabled, storeEnabled, exceptRef, setLastCode])
}
