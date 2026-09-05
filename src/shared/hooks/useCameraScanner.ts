import { useCallback, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

const HINTS = new Map<DecodeHintType, unknown>()
HINTS.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.QR_CODE,
])

export interface UseCameraScannerOptions {
  onDecode: (code: string) => void
}

/** Continuous camera barcode scanning via ZXing — shared by the single-item scan button
 * (Venta/Inventario) and the bulk "escaneo masivo" modal (Fase 3), replacing the two
 * near-identical copies in the legacy app (index.html L5103-5152, L6209-6281). */
export function useCameraScanner({ onDecode }: UseCameraScannerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onDecodeRef = useRef(onDecode)
  onDecodeRef.current = onDecode

  const stop = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    setActive(false)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    if (!videoRef.current) return
    try {
      const reader = new BrowserMultiFormatReader(HINTS)
      const devices = await BrowserMultiFormatReader.listVideoInputDevices()
      const back = devices.find((d) => /back|rear|environment/i.test(d.label)) ?? devices[devices.length - 1]
      const controls = await reader.decodeFromVideoDevice(back?.deviceId, videoRef.current, (result) => {
        if (result) onDecodeRef.current(result.getText())
      })
      controlsRef.current = controls
      setActive(true)
    } catch {
      setError('No se pudo acceder a la cámara')
      setActive(false)
    }
  }, [])

  return { videoRef, active, error, start, stop }
}
