import type { RefObject } from 'react'
import { useHidScanner } from './useHidScanner'
import { useCameraScanner } from './useCameraScanner'

export interface UseBarcodeScannerOptions {
  /** Called with the decoded barcode, from either the HID listener or the camera. */
  onScan: (code: string) => void
  /** An input that stays eligible for HID capture even while it holds focus (e.g. the search bar). */
  exceptRef?: RefObject<HTMLElement | null>
  hidEnabled?: boolean
}

/** The single barcode-scanning entry point for the whole app (Venta, Inventario's entrada
 * rápida + código field, and the bulk "escaneo masivo" modal) — one shared implementation
 * instead of three separate ones (see plan: "Escaneo de código de barras"). Each call site
 * only changes what `onScan` does with the code; the HID timing-detector and the camera
 * decoder are implemented exactly once, in `useHidScanner`/`useCameraScanner`. */
export function useBarcodeScanner({ onScan, exceptRef, hidEnabled = true }: UseBarcodeScannerOptions) {
  useHidScanner({ onScan, exceptRef, enabled: hidEnabled })
  return useCameraScanner({ onDecode: onScan })
}
