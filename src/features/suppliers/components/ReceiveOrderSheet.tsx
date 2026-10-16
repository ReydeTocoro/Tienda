import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db/index'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { receiveOrder } from '../../../db/repositories/purchaseOrders'
import { addDaysToKey, CAJA_LABEL, daysBetween, formatDayKey, round2 } from '../../../shared/lib/cash'
import { formatMoney, formatQty, todayKey } from '../../../shared/lib/currency'
import { formatOrderId } from '../../../shared/lib/id'
import { useMayorStore } from '../../../store/useMayorStore'
import { toast } from '../../../store/useToastStore'
import type { CajaId } from '../../../types/cash'
import type { PurchaseOrder } from '../../../types/purchaseOrder'
import { useActorName, useCaja } from '../../cash/hooks/useCaja'
import { MAYOR_MASK } from '../../cash/mayorEye'
import { termsLabel } from '../lib/terms'

/** Product, what arrived, its cost and its selling price from now on. */
const RECEIVE_GRID = 'grid-cols-[minmax(0,1fr)_64px_84px_84px]'
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/

interface ReceiveOrderSheetProps {
  order: PurchaseOrder | null
  onClose: () => void
  onReceived: () => void
}

/** "Marcar como recibido": confirm what really arrived (the only moment stock grows), at what cost and at what selling
 * price from now on, then say how it is paid — cash out of a caja right now, or an account payable due on the
 * supplier's terms. Only the products change: sales already made keep their prices. */
export function ReceiveOrderSheet({ order, onClose, onReceived }: ReceiveOrderSheetProps) {
  return (
    <BottomSheet open={!!order} onClose={onClose} maxWidthClass="max-w-[560px]">
      {order && <ReceiveForm order={order} onClose={onClose} onReceived={onReceived} />}
    </BottomSheet>
  )
}

function ReceiveForm({ order, onClose, onReceived }: { order: PurchaseOrder; onClose: () => void; onReceived: () => void }) {
  const { menor, mayor, balancesKnown } = useCaja()
  const actor = useActorName()
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(order.lines.map((l) => [l.code, String(l.qty)])))
  const [costs, setCosts] = useState<Record<string, string>>(() => Object.fromEntries(order.lines.map((l) => [l.code, String(l.unitCost)])))
  // Today's selling prices; a field nobody touched shows the one the order planned, else today's.
  const current = useLiveQuery(() => db.products.bulkGet(order.lines.map((l) => l.code)).then((ps) => new Map(ps.flatMap((p) => (p ? [[p.code, p.price] as [string, number]] : [])))), [order])
  const [prices, setPrices] = useState<Record<string, string>>({})
  const priceText = (code: string, planned?: number) => prices[code] ?? String(planned ?? current?.get(code) ?? '')
  const creditAllowed = order.paymentTerms.kind === 'credito'
  const [mode, setMode] = useState<'contado' | 'credito'>(creditAllowed ? 'credito' : 'contado')
  const [caja, setCaja] = useState<CajaId>('mayor')
  const [busy, setBusy] = useState(false)
  // On credit: the day the supplier invoiced it — the days of credit count from it, whenever the goods arrived — and the day
  // it is due, which is that day + the supplier's days until one is typed by hand.
  const today = todayKey()
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [dueTyped, setDueTyped] = useState<string | null>(null)

  const lines = order.lines.map((l) => ({ ...l, qtyReceived: parseFloat(qtys[l.code]) || 0, unitCost: parseFloat(costs[l.code]) || 0, newPrice: parseFloat(priceText(l.code, l.salePrice)) || 0 }))
  const total = round2(lines.reduce((t, l) => t + l.qtyReceived * l.unitCost, 0))
  const repriced = lines.filter((l) => l.qtyReceived > 0 && l.newPrice > 0 && current && l.newPrice !== current.get(l.code)).length
  const balances = { menor, mayor }
  // A closed Caja Mayor shows no balance (its eye, in Cajas); the server still checks the funds.
  const mayorOpen = useMayorStore((s) => s.open)
  const shows = (c: CajaId) => balancesKnown && (c !== 'mayor' || mayorOpen)
  // Without "ver el efectivo esperado" the balances never reach this device: the server decides.
  const insufficient = shows(caja) && mode === 'contado' && total > 0 && balances[caja] + 0.005 < total
  const creditDays = order.paymentTerms.kind === 'credito' ? order.paymentTerms.days : 0
  const invoiceOk = DAY_KEY.test(invoiceDate)
  const dueKey = creditAllowed && invoiceOk ? (dueTyped ?? addDaysToKey(invoiceDate, creditDays)) : null
  const dateProblem =
    mode !== 'credito'
      ? null
      : !invoiceOk
        ? 'Elige la fecha de la factura'
        : invoiceDate > today
          ? 'La fecha de la factura no puede ser futura'
          : daysBetween(invoiceDate, today) > 365
            ? 'La factura es de hace más de un año: revisa la fecha'
            : !dueKey || !DAY_KEY.test(dueKey)
              ? 'Elige la fecha de vencimiento'
              : dueKey < invoiceDate
                ? 'El vencimiento no puede ser antes de la factura'
                : daysBetween(invoiceDate, dueKey) > 365
                  ? 'El vencimiento está a más de un año de la factura: revísalo'
                  : null

  async function submit() {
    if (!lines.some((l) => l.qtyReceived > 0)) {
      toast('Indica qué cantidades llegaron', 'orange')
      return
    }
    if (dateProblem) {
      toast(dateProblem, 'orange')
      return
    }
    setBusy(true)
    try {
      const done = await receiveOrder(order.id!, {
        // An empty price is "no change" (null), not "what the order planned".
        lines: lines.map((l) => ({ code: l.code, qtyReceived: l.qtyReceived, unitCost: l.unitCost, salePrice: l.newPrice > 0 ? l.newPrice : null })),
        payment: mode === 'contado' ? { mode: 'contado', caja } : { mode: 'credito' },
        by: actor,
        ...(mode === 'credito' && dueKey ? { invoiceDate, dueDate: dueKey } : {}),
      })
      // A server that doesn't know the dates yet would count the credit from today without a word.
      if (mode === 'credito' && done.invoiceDate !== invoiceDate) toast('El servidor todavía no guarda la fecha de la factura: revisa la fecha de vencimiento en "Por pagar"', 'red')
      toast(`Pedido ${formatOrderId(order.id)} recibido · stock actualizado`, 'green')
      onReceived()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'red')
    } finally {
      setBusy(false)
    }
  }

  const choice = (is: boolean) => `flex-1 rounded-xl border-2 p-2.5 text-left transition-colors ${is ? 'border-lime bg-lime/10' : 'border-br hover:border-br2 hover:bg-s2'}`

  return (
    <>
      <div className="mb-0.5 font-display text-[18px] font-bold">Recibir pedido {formatOrderId(order.id)}</div>
      <div className="mb-3.5 text-[12px] text-muted">
        {order.supplierName} · {termsLabel(order.paymentTerms)}
      </div>

      <div className={`mb-1 grid ${RECEIVE_GRID} gap-2 px-1 text-[10px] text-muted`}>
        <span>Producto (pedido)</span>
        <span className="text-right">Llegó</span>
        <span className="text-right">Costo unit.</span>
        <span className="text-right">Precio venta</span>
      </div>
      <div className="mb-1.5 max-h-[34vh] overflow-y-auto rounded-xl border border-br">
        {order.lines.map((l) => {
          const today = current?.get(l.code)
          const price = priceText(l.code, l.salePrice)
          const changed = today !== undefined && parseFloat(price) > 0 && parseFloat(price) !== today
          return (
            <div key={l.code} className={`grid ${RECEIVE_GRID} items-center gap-2 border-b border-br px-2.5 py-2 last:border-b-0`}>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">{l.name}</div>
                <div className="truncate text-[10px] text-muted">
                  pedido: {formatQty(l.qty)}
                  {today !== undefined && ` · venta hoy ${formatMoney(today)}`}
                </div>
              </div>
              <input className="input px-2 py-1.5 text-right font-mono text-[13px]" type="number" min={0} step="any" aria-label={`Cantidad que llegó de ${l.name}`} value={qtys[l.code]} onChange={(e) => setQtys((s) => ({ ...s, [l.code]: e.target.value }))} />
              <input className="input px-2 py-1.5 text-right font-mono text-[13px]" type="number" min={0} step="any" aria-label={`Costo unitario de ${l.name}`} value={costs[l.code]} onChange={(e) => setCosts((s) => ({ ...s, [l.code]: e.target.value }))} />
              <input
                className={`input px-2 py-1.5 text-right font-mono text-[13px] ${changed ? 'border-lime bg-lime/10 font-bold text-lime' : ''}`}
                type="number"
                min={0}
                step="any"
                aria-label={`Precio de venta de ${l.name}`}
                title={changed ? `El precio de venta pasa de ${formatMoney(today)} a ${formatMoney(parseFloat(price))}` : 'Precio de venta desde ahora'}
                value={price}
                onChange={(e) => setPrices((s) => ({ ...s, [l.code]: e.target.value }))}
              />
            </div>
          )
        })}
      </div>
      <div className="mb-3 px-1 text-[11px] leading-snug text-txt2">
        Al recibir se suma al stock y se actualizan el costo{repriced > 0 ? ` y ${repriced === 1 ? '1 precio de venta' : `${repriced} precios de venta`}` : ''}. Las ventas ya hechas no cambian.
      </div>

      <div className="mb-3.5 flex items-center justify-between rounded-lg bg-s2 px-3 py-2.5">
        <span className="text-[13px] text-txt2">Total a pagar</span>
        <span className="font-mono text-[20px] font-bold text-lime">{formatMoney(total)}</span>
      </div>

      <div className="mb-2 field-label">¿Cómo se paga?</div>
      <div className="mb-3 flex gap-2">
        <button type="button" onClick={() => setMode('contado')} className={choice(mode === 'contado')}>
          <div className="text-[13px] font-bold">De contado</div>
          <div className="text-[11px] text-txt2">Sale de una caja ahora</div>
        </button>
        {creditAllowed && (
          <button type="button" onClick={() => setMode('credito')} className={choice(mode === 'credito')}>
            <div className="text-[13px] font-bold">A crédito</div>
            <div className="text-[11px] text-txt2">Cuenta por pagar</div>
          </button>
        )}
      </div>

      {mode === 'contado' ? (
        <>
          <div className="mb-1.5 field-label">¿De dónde sale el dinero?</div>
          <div className="mb-2 flex gap-2">
            {(['mayor', 'menor'] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCaja(c)} className={choice(caja === c)}>
                <div className="text-[13px] font-bold">{CAJA_LABEL[c]}</div>
                {shows(c) ? (
                  <div className={`font-mono text-[12px] ${balances[c] + 0.005 < total ? 'text-red' : 'text-txt2'}`}>{formatMoney(balances[c])}</div>
                ) : (
                  balancesKnown && <div className="font-mono text-[12px] text-muted">{MAYOR_MASK}</div>
                )}
              </button>
            ))}
          </div>
          {insufficient && <div className="mb-2 rounded-lg bg-red/10 px-3 py-2 text-[12px] font-semibold text-red">{CAJA_LABEL[caja]} no tiene saldo suficiente. Elige la otra caja o traslada fondos.</div>}
        </>
      ) : (
        <div className="mb-2 rounded-xl border border-br p-3">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="receive-invoice-date" className="mb-1 block field-label">
                Fecha de la factura
              </label>
              <input id="receive-invoice-date" type="date" className="input px-2.5 py-2 text-[13px]" max={today} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="receive-due-date" className="mb-1 block field-label">
                Vence el
              </label>
              <input id="receive-due-date" type="date" className="input px-2.5 py-2 text-[13px]" min={invoiceOk ? invoiceDate : undefined} value={dueKey ?? ''} onChange={(e) => setDueTyped(e.target.value)} />
            </div>
          </div>
          {dateProblem ? (
            <div className="mt-2 text-[12px] font-semibold text-red">{dateProblem}</div>
          ) : (
            dueKey && (
              <div className="mt-2 text-[12px] text-blue">
                Se crea una cuenta por pagar de <b className="font-mono">{formatMoney(total)}</b> que vence el <b>{formatDayKey(dueKey)}</b> ({daysBetween(invoiceDate, dueKey)} días después de la factura).
                {dueKey < today && (
                  <span className="font-semibold text-orange">
                    {' '}
                    Ya nace vencida (hace {daysBetween(dueKey, today)} {daysBetween(dueKey, today) === 1 ? 'día' : 'días'}).
                  </span>
                )}
              </div>
            )
          )}
          {dueTyped !== null && (
            <button type="button" onClick={() => setDueTyped(null)} className="mt-1.5 text-[11px] font-semibold text-lime underline">
              Volver a contar los {creditDays} días del proveedor desde la factura
            </button>
          )}
        </div>
      )}

      <div className="mt-3.5 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cancelar
        </button>
        <button disabled={busy || insufficient || !!dateProblem} onClick={submit} className="flex-[2] rounded-[10px] bg-lime py-2.5 text-[14px] font-bold text-on-solid disabled:opacity-50">
          Recibir y registrar
        </button>
      </div>
    </>
  )
}
