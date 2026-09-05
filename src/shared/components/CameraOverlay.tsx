import type { RefObject } from 'react'

interface CameraOverlayProps {
  open: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  onClose: () => void
  title?: string
  hint?: string
}

/** Fullscreen camera view for barcode scanning — shared markup for the single-item scan
 * button (Venta/Inventario) and the bulk scan modal (Fase 3), matching legacy `#cam-wrap`
 * (index.html L1744-1753). */
export function CameraOverlay({ open, videoRef, onClose, title = '📷 Escanear código', hint = 'Centra el código en el recuadro' }: CameraOverlayProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/85 to-transparent px-4.5 py-3.5">
        <span className="font-display text-[16px] text-lime">{title}</span>
        <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-[19px] text-white">
          ✕
        </button>
      </div>
      <div className="relative z-[5] h-[150px] w-[250px] rounded-[10px] border-2 border-lime shadow-[0_0_0_9999px_rgba(0,0,0,0.48)]" />
      <div className="absolute bottom-[38px] z-10 px-7 text-center text-[12px] text-white/65">{hint}</div>
    </div>
  )
}
