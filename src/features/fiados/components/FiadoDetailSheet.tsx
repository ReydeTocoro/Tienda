import { useState } from 'react'
import type { FiadoGroup } from '../lib/fiadoGrouping'
import { groupTotals } from '../lib/fiadoGrouping'
import { getFiadoDebt, addFiadoPago, payFiadoInFull, payAllFiados } from '../../../db/repositories/sales'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { AbonoModal } from './AbonoModal'
import { useConfirm } from '../../../store/useConfirmStore'
import { toast } from '../../../store/useToastStore'
import { formatDateTime, formatMoney } from '../../../shared/lib/currency'
import { formatSaleId } from '../../../shared/lib/id'
import { initials } from '../../../shared/lib/text'
import type { Customer } from '../../../types/customer'
import { usePermission } from '../../pin/usePermission'

interface FiadoDetailSheetProps {
  group: FiadoGroup | null
  customer: Customer | null
  onClose: () => void
}

/** legacy `openFiadoDetail()` (index.html L4834-4996). */
export function FiadoDetailSheet({ group, customer, onClose }: FiadoDetailSheetProps) {
  const [abonoTarget, setAbonoTarget] = useState<{ saleId: number; maxDebt: number } | null>(null)
  const confirm = useConfirm()
  const { requireAdmin } = usePermission()

  if (!group) return null
  const { totalOwed, totalDebt, totalPaid } = groupTotals(group)

  async function openAbono(saleId: number, maxDebt: number) {
    const ok = await requireAdmin('🔐 Registrar Abono', 'Se requiere PIN para registrar el abono')
    if (!ok) return
    setAbonoTarget({ saleId, maxDebt })
  }

  async function abonar(amount: number, note: string) {
    if (!abonoTarget) return
    await addFiadoPago(abonoTarget.saleId, { amount, date: new Date().toISOString(), note })
    toast(`✓ Abono de ${formatMoney(amount)} registrado`, 'green')
    setAbonoTarget(null)
  }

  async function pagar(saleId: number, debt: number) {
    const isAdmin = await requireAdmin('🔐 Pago de Fiado', 'Se requiere PIN para registrar el pago')
    if (!isAdmin) return
    const ok = await confirm(`¿Marcar este fiado como pagado en su totalidad (${formatMoney(debt)})?`)
    if (!ok) return
    await payFiadoInFull(saleId)
    toast('✓ Fiado pagado', 'green')
  }

  async function condonar(saleId: number, debt: number) {
    const isAdmin = await requireAdmin('🔐 Condonar Deuda', 'Se requiere PIN para condonar un fiado')
    if (!isAdmin) return
    const ok = await confirm({ message: `¿Condonar (perdonar) esta deuda de ${formatMoney(debt)}? Se marcará como cancelada sin cobro.`, danger: true })
    if (!ok) return
    await payFiadoInFull(saleId, '✗ Deuda condonada/abandonada')
    toast('Deuda condonada', 'muted')
  }

  async function pagarTodo() {
    if (!group) return
    const isAdmin = await requireAdmin('🔐 Pago de Fiado', 'Se requiere PIN para registrar el pago')
    if (!isAdmin) return
    const ok = await confirm(`¿Marcar TODOS los fiados como pagados? Total: ${formatMoney(totalDebt)}`)
    if (!ok) return
    const paid = await payAllFiados(
      group.sales.map((s) => s.id!),
      'Pago total de todos los fiados',
    )
    toast(`✓ ${formatMoney(paid)} cobrados`, 'green')
  }

  async function condonarTodo() {
    if (!group) return
    const isAdmin = await requireAdmin('🔐 Condonar Deuda', 'Se requiere PIN para condonar un fiado')
    if (!isAdmin) return
    const ok = await confirm({ message: `¿Condonar TODOS los fiados de ${group.name}? Total: ${formatMoney(totalDebt)}. Esto no puede deshacerse.`, danger: true })
    if (!ok) return
    await payAllFiados(
      group.sales.map((s) => s.id!),
      '✗ Deuda condonada/abandonada',
    )
    toast('Deudas condonadas', 'muted')
  }

  return (
    <>
      <BottomSheet open={!!group} onClose={onClose}>
        <div className="mb-4 flex items-center gap-3 border-b border-br pb-3.5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-red/30 bg-red/10 text-[17px] font-bold text-red">
            {initials(group.name)}
          </div>
          <div>
            <div className="font-display text-[18px] font-bold">{group.name}</div>
            {customer && (
              <div className="text-[11px] text-muted">
                {customer.cedula ? '🪪 ' + customer.cedula + ' · ' : ''}
                {customer.phone || ''}
              </div>
            )}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <div className="rounded-[10px] bg-s2 p-2.5 text-center">
            <div className="field-label">Debe</div>
            <div className="font-mono text-[16px] font-bold text-red">{formatMoney(totalDebt)}</div>
          </div>
          <div className="rounded-[10px] bg-s2 p-2.5 text-center">
            <div className="field-label">Abonado</div>
            <div className="font-mono text-[16px] font-bold text-green">{formatMoney(totalPaid)}</div>
          </div>
          <div className="rounded-[10px] bg-s2 p-2.5 text-center">
            <div className="field-label">Original</div>
            <div className="font-mono text-[15px] font-semibold text-txt2">{formatMoney(totalOwed)}</div>
          </div>
        </div>

        {totalDebt > 0 ? (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <button onClick={pagarTodo} className="rounded-[10px] border border-green/25 bg-green/10 py-2.5 text-[13px] font-semibold text-green">
              ✓ Pagar todo ({formatMoney(totalDebt)})
            </button>
            <button onClick={condonarTodo} className="rounded-[10px] border border-red/25 bg-red/10 py-2.5 text-[13px] font-semibold text-red">
              ✗ Condonar todo
            </button>
          </div>
        ) : (
          <div className="mb-4 rounded-xl border border-green/25 bg-green/10 py-3 text-center font-bold text-green">🎉 ¡Todo pagado!</div>
        )}

        <p className="mb-2.5 field-label">Detalle por fiado</p>
        {group.sales.map((s) => {
          const debt = getFiadoDebt(s)
          const isPaid = debt <= 0
          return (
            <div key={s.id} className={`mb-2 rounded-xl border p-3 ${isPaid ? 'border-green/25' : 'border-br'} bg-s2`}>
              <div className="mb-1 flex items-start justify-between">
                <div>
                  <div className="font-mono text-[11px] text-lime">
                    {formatSaleId(s.id)} · {formatDateTime(s.date)}
                  </div>
                  <div className="mt-0.5 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-txt2">
                    {s.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className={`font-mono text-[14px] ${isPaid ? 'text-green' : 'text-red'}`}>{isPaid ? '✓ Pagado' : formatMoney(debt)}</div>
                  {!isPaid && debt < s.total && <div className="text-[10px] text-muted">Total: {formatMoney(s.total)}</div>}
                </div>
              </div>
              {(s.fiadoPagos || []).map((p, i) => (
                <div key={i} className="flex justify-between text-[11px] text-green">
                  <span>
                    ✓ Abono {formatDateTime(p.date)}
                    {p.note ? ' · ' + p.note : ''}
                  </span>
                  <span>+{formatMoney(p.amount)}</span>
                </div>
              ))}
              {!isPaid && (
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => openAbono(s.id!, debt)} className="flex-1 rounded-lg border border-br2 py-1.5 text-[11px] text-txt2">
                    💰 Abonar
                  </button>
                  <button onClick={() => pagar(s.id!, debt)} className="flex-1 rounded-lg border border-green/25 bg-green/10 py-1.5 text-[11px] text-green">
                    ✓ Pagar total
                  </button>
                  <button onClick={() => condonar(s.id!, debt)} className="flex-1 rounded-lg border border-red/25 bg-red/10 py-1.5 text-[11px] text-red">
                    ✗ Condonar
                  </button>
                </div>
              )}
            </div>
          )
        })}

        <button onClick={onClose} className="mt-2 w-full rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cerrar
        </button>
      </BottomSheet>

      <AbonoModal open={!!abonoTarget} maxDebt={abonoTarget?.maxDebt ?? 0} onClose={() => setAbonoTarget(null)} onConfirm={abonar} />
    </>
  )
}
