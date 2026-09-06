import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/index'
import type { Sale } from '../../types/sale'
import { formatDateTime, formatMoney } from '../../shared/lib/currency'
import { formatPurchaseId, formatSaleId } from '../../shared/lib/id'
import { ReceiptSheet } from '../../shared/components/ReceiptSheet'
import { PurchaseFormSheet } from './components/PurchaseFormSheet'
import { CorrectionModal } from './components/CorrectionModal'
import { usePermission } from '../pin/usePermission'

const PAY_PILL: Record<string, string> = {
  efectivo: 'bg-green/10 text-green',
  transferencia: 'bg-blue/10 text-blue',
  fiado: 'bg-red/10 text-red',
}

type Row = { kind: 'venta'; date: string; sale: Sale } | { kind: 'compra'; date: string; id?: number; desc: string; total: number }

export function HistorialPage() {
  const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().toArray(), [], []) as Sale[]
  const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().toArray(), [], [])
  const [receiptSale, setReceiptSale] = useState<Sale | null>(null)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [correctingSale, setCorrectingSale] = useState<Sale | null>(null)
  const { requireAdmin } = usePermission()

  async function requestCorrection(sale: Sale) {
    const ok = await requireAdmin('🔐 Corregir Factura', 'Se requiere PIN para modificar una venta')
    if (!ok) return
    setCorrectingSale(sale)
    setReceiptSale(null)
  }

  const rows: Row[] = useMemo(() => {
    const a: Row[] = sales.map((s) => ({ kind: 'venta', date: s.date, sale: s }))
    const b: Row[] = purchases.map((p) => ({ kind: 'compra', date: p.date, id: p.id, desc: p.desc, total: p.total }))
    return [...a, ...b].sort((x, y) => (x.date < y.date ? 1 : -1))
  }, [sales, purchases])

  return (
    <div className="p-3.5">
      <div className="mb-3.5 flex items-center justify-between">
        <p className="font-display text-[21px] font-bold">Historial</p>
        <button onClick={() => setPurchaseOpen(true)} className="rounded-[10px] border border-br2 px-3 py-2 text-[12px] text-txt2">
          + Compra
        </button>
      </div>

      {!rows.length ? (
        <div className="p-10 text-center text-muted">
          <div className="mb-2.5 text-4xl">📋</div>
          <p className="text-[13px]">Sin registros aún</p>
        </div>
      ) : (
        rows.map((r, i) =>
          r.kind === 'venta' ? (
            <button
              key={'v' + i}
              onClick={() => setReceiptSale(r.sale)}
              className="mb-2 block w-full rounded-xl border border-br bg-s1 p-3 text-left"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-[12px] text-lime">
                    {formatSaleId(r.sale.id)}{' '}
                    <span className="rounded-full bg-lime/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-lime">↑ Venta</span>{' '}
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${PAY_PILL[r.sale.payMethod]}`}>
                      {r.sale.payMethod}
                    </span>
                    {r.sale.corrected && (
                      <span className="rounded-full bg-orange/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange">
                        ✏️ corregida
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">{formatDateTime(r.sale.date)}</div>
                  {r.sale.customerName && <div className="mt-0.5 text-[11px] text-blue">👤 {r.sale.customerName}</div>}
                  {!r.sale.customerName && r.sale.fiadoName && <div className="mt-0.5 text-[11px] text-red">📋 Fiado: {r.sale.fiadoName}</div>}
                </div>
                <div className="font-mono text-[17px] font-semibold text-green">{formatMoney(r.sale.total)}</div>
              </div>
              <div className="mt-1.5 text-[12px] text-txt2">
                {r.sale.items
                  .map((it) => `${it.name} ×${it.qty}`)
                  .join(', ')
                  .slice(0, 85)}
              </div>
            </button>
          ) : (
            <div key={'c' + i} className="mb-2 rounded-xl border border-br bg-s1 p-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-[12px] text-orange">
                    {formatPurchaseId(r.id)}{' '}
                    <span className="rounded-full bg-orange/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange">↓ Compra</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted">{formatDateTime(r.date)}</div>
                </div>
                <div className="font-mono text-[17px] font-semibold text-red">{formatMoney(r.total)}</div>
              </div>
              <div className="mt-1.5 text-[12px] text-txt2">{r.desc}</div>
            </div>
          ),
        )
      )}

      <ReceiptSheet
        sale={receiptSale}
        onClose={() => setReceiptSale(null)}
        onCorrect={receiptSale ? () => requestCorrection(receiptSale) : undefined}
      />
      <PurchaseFormSheet open={purchaseOpen} onClose={() => setPurchaseOpen(false)} />
      <CorrectionModal sale={correctingSale} onClose={() => setCorrectingSale(null)} onCorrected={() => setCorrectingSale(null)} />
    </div>
  )
}
