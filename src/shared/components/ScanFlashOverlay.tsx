interface ScanFlashOverlayProps {
  show: boolean
  success?: boolean
}

/** Brief full-screen flash feedback when a barcode is decoded — legacy `#scan-flash`
 * (index.html L694-699, `_flash()` in the HID module L2015-2023). */
export function ScanFlashOverlay({ show, success = true }: ScanFlashOverlayProps) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[7999] transition-opacity duration-150"
      style={{ opacity: show ? 1 : 0, background: success ? 'rgba(200,240,96,0.10)' : 'rgba(255,107,107,0.10)' }}
    />
  )
}
