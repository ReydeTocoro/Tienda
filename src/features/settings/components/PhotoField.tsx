import { useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { photoFromFile } from '../../../shared/lib/image'
import { secondaryButton } from './ui'

/** Picks, replaces or removes a profile picture. The chosen file becomes a small square JPEG right
 * here in the browser (src/shared/lib/image.ts); a phone offers its camera as well as its gallery. */
export function PhotoField({ photo, hint, onChange }: { photo: string | undefined; hint: string; onChange: (photo: string | undefined) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setError('')
    setBusy(true)
    try {
      onChange(await photoFromFile(file))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const small = `${secondaryButton} flex items-center gap-1.5 px-3 py-1.5 text-[12px]`
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-br p-3">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">Foto</div>
        <div className="text-[12px] text-muted">{hint}</div>
        {error && (
          <p role="alert" className="mt-1 text-[12px] font-semibold text-red">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-shrink-0 gap-1.5">
        <button type="button" disabled={busy} className={small} onClick={() => input.current?.click()}>
          <Camera size={14} />
          {busy ? 'Cargando…' : photo ? 'Cambiar' : 'Elegir foto'}
        </button>
        {photo && (
          <button
            type="button"
            className={small}
            onClick={() => {
              setError('')
              onChange(undefined)
            }}
          >
            <Trash2 size={14} />
            Quitar
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        aria-label="Elegir una foto"
        hidden
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}
