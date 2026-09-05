import { useState } from 'react'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import type { DupAction, ParsedImportRow } from '../lib/importProducts'
import { formatMoney } from '../../../shared/lib/currency'

interface ImportPreviewModalProps {
  open: boolean
  fileName: string
  parsed: ParsedImportRow[]
  errors: string[]
  onClose: () => void
  onConfirm: (dupAction: DupAction) => void
}

/** Import preview with dedup handling — legacy `showImportPreview()`/`confirmImport()`
 * (index.html L5537-5651). */
export function ImportPreviewModal({ open, fileName, parsed, errors, onClose, onConfirm }: ImportPreviewModalProps) {
  const [dupAction, setDupAction] = useState<DupAction>('update')
  if (!open) return null

  const total = parsed.length
  const newCount = parsed.filter((r) => r.isNew).length
  const updateCount = total - newCount
  const warnCount = parsed.filter((r) => r.warnings.length).length

  return (
    <BottomSheet open={open} onClose={onClose} maxWidthClass="max-w-[720px]" zIndexClass="z-[3000]">
      <p className="mb-1 font-display text-[18px] font-bold">📥 Vista previa de importación</p>
      <div className="mb-3.5 text-[12px] text-muted">
        <b>{fileName}</b> · {total} producto{total !== 1 ? 's' : ''} · <span className="text-green">{newCount} nuevo{newCount !== 1 ? 's' : ''}</span> ·{' '}
        <span className="text-blue">{updateCount} actualización{updateCount !== 1 ? 'es' : ''}</span>
        {warnCount > 0 && <span className="text-orange"> · ⚠ {warnCount} advertencia{warnCount !== 1 ? 's' : ''}</span>}
      </div>

      {errors.length > 0 && (
        <div className="mb-3 rounded-[10px] border border-red/30 bg-red/10 p-2.5 text-[12px] text-red">
          <b>⚠ {errors.length} advertencia{errors.length !== 1 ? 's' : ''}:</b>
          <br />
          {errors.slice(0, 20).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-2 rounded-[10px] bg-s2 p-2.5">
        <span className="text-[12px] font-semibold text-txt2">Si el código ya existe:</span>
        <select value={dupAction} onChange={(e) => setDupAction(e.target.value as DupAction)} className="rounded-lg border border-br2 bg-s3 px-2.5 py-1.5 text-[12px] outline-none">
          <option value="update">Actualizar precio y stock</option>
          <option value="skip">Ignorar (mantener actual)</option>
          <option value="stock_only">Solo sumar stock</option>
        </select>
      </div>

      <div className="mb-3.5 max-h-[320px] overflow-auto rounded-[10px] border border-br">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-s2">
            <tr>
              {['Estado', 'Código', 'Nombre', 'Precio', 'Costo', 'Stock', 'Categoría'].map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-br px-2.5 py-1.5 text-left text-[10px] uppercase tracking-wide text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsed.slice(0, 80).map((r) => (
              <tr key={r.code} className={r.isNew ? '' : 'opacity-80'}>
                <td className={`border-b border-br px-2.5 py-1.5 text-[11px] font-bold ${r.isNew ? 'text-green' : 'text-blue'}`}>{r.isNew ? '🆕 Nuevo' : '🔄 Actualizar'}</td>
                <td className="border-b border-br px-2.5 py-1.5 font-mono text-[11px]">{r.code}</td>
                <td className="border-b border-br px-2.5 py-1.5 font-semibold">
                  {r.name}
                  {r.existingName && r.existingName !== r.name && <div className="text-[10px] text-muted">Era: {r.existingName}</div>}
                  {r.warnings.length > 0 && <div className="text-[10px] text-orange">⚠ {r.warnings.join(', ')}</div>}
                </td>
                <td className="border-b border-br px-2.5 py-1.5 font-mono text-lime">{formatMoney(r.price)}</td>
                <td className="border-b border-br px-2.5 py-1.5 font-mono text-muted">{formatMoney(r.cost)}</td>
                <td className="border-b border-br px-2.5 py-1.5 font-mono">{r.stock}</td>
                <td className="border-b border-br px-2.5 py-1.5 text-txt2">{r.cat || '—'}</td>
              </tr>
            ))}
            {parsed.length > 80 && (
              <tr>
                <td colSpan={7} className="px-2.5 py-2 text-center text-muted">
                  ... y {parsed.length - 80} más
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button onClick={() => onConfirm(dupAction)} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-extrabold text-black">
          ✓ Confirmar importación
        </button>
      </div>
    </BottomSheet>
  )
}
