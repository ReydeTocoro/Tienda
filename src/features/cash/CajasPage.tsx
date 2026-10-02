import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Lock, LockOpen, Minus, Plus } from 'lucide-react'
import { addDaysToKey, CAJA_LABEL, round2 } from '../../shared/lib/cash'
import { formatDateTime, formatMoney, todayKey } from '../../shared/lib/currency'
import type { CajaId, MovementType } from '../../types/cash'
import { CierreZModal } from '../reports/components/CierreZModal'
import { useCaja } from './hooks/useCaja'
import { MovementList } from './components/MovementList'
import { MovementFormSheet } from './components/MovementFormSheet'
import { OpenCajaSheet } from './components/OpenCajaSheet'
import { TransferSheet } from './components/TransferSheet'

type Sheet = { kind: 'open' } | { kind: 'move'; caja: CajaId; direction: 'in' | 'out' } | { kind: 'transfer'; from: CajaId } | null

const GROUPS: Record<string, { label: string; types: MovementType[] | null }> = {
  todos: { label: 'Todos los tipos', types: null },
  ventas: { label: 'Ventas y abonos', types: ['venta', 'ajuste_venta', 'abono_fiado'] },
  egresos: { label: 'Egresos', types: ['egreso'] },
  ingresos: { label: 'Ingresos', types: ['ingreso'] },
  traslados: { label: 'Traslados', types: ['traslado_salida', 'traslado_entrada'] },
  proveedores: { label: 'Pagos a proveedores', types: ['pago_proveedor'] },
  ajustes: { label: 'Ajustes de arqueo', types: ['ajuste_arqueo'] },
}

const PERIODS: Record<string, { label: string; days: number | null }> = {
  hoy: { label: 'Hoy', days: 0 },
  semana: { label: 'Últimos 7 días', days: 7 },
  mes: { label: 'Últimos 30 días', days: 30 },
  todo: { label: 'Todo', days: null },
}

const PAGE = 40

export function CajasPage() {
  const { ready, movements, menor, mayor, session, firstOpening } = useCaja()
  const [sheet, setSheet] = useState<Sheet>(null)
  const [cierreOpen, setCierreOpen] = useState(false)
  const [cajaFilter, setCajaFilter] = useState<'todas' | CajaId>('todas')
  const [group, setGroup] = useState('todos')
  const [period, setPeriod] = useState('hoy')
  const [visible, setVisible] = useState(PAGE)

  const today = todayKey()
  const filtered = useMemo(() => {
    const types = GROUPS[group].types
    const days = PERIODS[period].days
    const sinceKey = days === null ? null : addDaysToKey(today, -days)
    return movements
      .filter((m) => (cajaFilter === 'todas' || m.caja === cajaFilter) && (!types || types.includes(m.type)) && (days === 0 ? m.dayKey === today : sinceKey === null || m.dayKey >= sinceKey))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [movements, cajaFilter, group, period, today])

  const todayStats = useMemo(() => {
    let ventas = 0
    let egresos = 0
    let transferencias = 0
    for (const m of movements) {
      if (m.dayKey !== today) continue
      if (m.caja === 'mayor' && m.medio === 'transferencia') transferencias += m.direction === 'in' ? m.amount : -m.amount
      if (m.caja !== 'menor') continue
      if (m.type === 'venta' || m.type === 'abono_fiado' || m.type === 'ajuste_venta') ventas += m.direction === 'in' ? m.amount : -m.amount
      else if (m.type === 'egreso' || m.type === 'pago_proveedor') egresos += m.amount
    }
    return { ventas: round2(ventas), egresos: round2(egresos), transferencias: round2(transferencias) }
  }, [movements, today])

  const open = (s: Sheet) => setSheet(s)

  return (
    <div className="p-3.5 md:mx-auto md:max-w-[1200px] md:p-5">
      <h1 className="mb-3.5 font-display text-[21px] font-bold md:text-[22px]">Cajas</h1>

      <div className="mb-5 grid gap-3.5 md:grid-cols-2">
        <CajaCard
          title="Caja Menor"
          subtitle={!ready ? ' ' : session ? `Abierta desde ${formatDateTime(session.openedAt)} · ${session.openedBy}` : firstOpening ? 'Sin iniciar: la primera apertura registra tu base inicial' : 'Cerrada'}
          balance={menor}
          accent={session ? 'text-green' : 'text-txt2'}
        >
          <div className="mb-3 grid grid-cols-2 gap-2 text-[12px]">
            <MiniStat label="Ventas y abonos hoy" value={formatMoney(todayStats.ventas)} color="text-green" />
            <MiniStat label="Egresos hoy" value={formatMoney(todayStats.egresos)} color="text-red" />
          </div>
          <div className="flex flex-wrap gap-2">
            {session ? (
              <ActionButton icon={Lock} label="Cerrar caja (Cierre Z)" tone="red" onClick={() => setCierreOpen(true)} />
            ) : (
              <ActionButton icon={LockOpen} label={firstOpening ? 'Iniciar cajas' : 'Abrir caja'} tone="green" onClick={() => open({ kind: 'open' })} />
            )}
            <ActionButton icon={Minus} label="Egreso" onClick={() => open({ kind: 'move', caja: 'menor', direction: 'out' })} />
            <ActionButton icon={Plus} label="Ingreso" onClick={() => open({ kind: 'move', caja: 'menor', direction: 'in' })} />
            <ActionButton icon={ArrowLeftRight} label="Trasladar a Caja Mayor" onClick={() => open({ kind: 'transfer', from: 'menor' })} />
          </div>
        </CajaCard>

        <CajaCard title="Caja Mayor" subtitle="Caja fuerte y bancos: recibe traslados y transferencias, y paga lo grande" balance={mayor} accent="text-lime">
          <div className="mb-3 grid grid-cols-2 gap-2 text-[12px]">
            <MiniStat label="Transferencias recibidas hoy" value={formatMoney(todayStats.transferencias)} color="text-blue" />
            <div className="rounded-lg bg-s2 px-3 py-2 text-[11px] text-txt2">Nómina, servicios, arriendo y pagos a proveedores salen de aquí.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton icon={Minus} label="Registrar egreso" onClick={() => open({ kind: 'move', caja: 'mayor', direction: 'out' })} />
            <ActionButton icon={Plus} label="Ingreso" onClick={() => open({ kind: 'move', caja: 'mayor', direction: 'in' })} />
            <ActionButton icon={ArrowLeftRight} label="Reponer Caja Menor" onClick={() => open({ kind: 'transfer', from: 'mayor' })} />
          </div>
        </CajaCard>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[15px] font-bold">Movimientos</h2>
        <select className="input w-auto py-2 text-[13px]" value={cajaFilter} onChange={(e) => setCajaFilter(e.target.value as 'todas' | CajaId)} aria-label="Caja">
          <option value="todas">Ambas cajas</option>
          <option value="menor">{CAJA_LABEL.menor}</option>
          <option value="mayor">{CAJA_LABEL.mayor}</option>
        </select>
        <select className="input w-auto py-2 text-[13px]" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Tipo">
          {Object.entries(GROUPS).map(([k, g]) => (
            <option key={k} value={k}>
              {g.label}
            </option>
          ))}
        </select>
        <select className="input w-auto py-2 text-[13px]" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
          {Object.entries(PERIODS).map(([k, p]) => (
            <option key={k} value={k}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <MovementList movements={filtered.slice(0, visible)} showCaja={cajaFilter === 'todas'} />
      {filtered.length > visible && (
        <button onClick={() => setVisible((v) => v + PAGE)} className="mt-3 w-full rounded-[10px] border border-br2 py-2.5 text-[13px] font-semibold text-txt2 hover:bg-s2">
          Ver más ({filtered.length - visible} restantes)
        </button>
      )}

      <OpenCajaSheet open={sheet?.kind === 'open'} onClose={() => setSheet(null)} />
      <MovementFormSheet
        open={sheet?.kind === 'move'}
        onClose={() => setSheet(null)}
        caja={sheet?.kind === 'move' ? sheet.caja : 'menor'}
        direction={sheet?.kind === 'move' ? sheet.direction : 'out'}
        lockCaja
      />
      <TransferSheet open={sheet?.kind === 'transfer'} onClose={() => setSheet(null)} from={sheet?.kind === 'transfer' ? sheet.from : 'menor'} />
      <CierreZModal open={cierreOpen} dayKey={session?.dayKey ?? today} onClose={() => setCierreOpen(false)} onClosed={() => setCierreOpen(false)} />
    </div>
  )
}

function CajaCard({ title, subtitle, balance, accent, children }: { title: string; subtitle: string; balance: number; accent: string; children: ReactNode }) {
  return (
    <section className="rounded-[14px] border border-br bg-s1 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold">{title}</div>
          <div className="mt-0.5 text-[11px] text-muted">{subtitle}</div>
        </div>
        <div className="text-right">
          <div className="field-label">Saldo</div>
          <div className={`font-mono text-[24px] font-bold leading-tight ${balance < 0 ? 'text-red' : accent}`}>{formatMoney(balance)}</div>
        </div>
      </div>
      {children}
    </section>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-s2 px-3 py-2">
      <div className="field-label">{label}</div>
      <div className={`font-mono text-[14px] font-bold ${color}`}>{value}</div>
    </div>
  )
}

function ActionButton({ icon: Icon, label, onClick, tone }: { icon: typeof Plus; label: string; onClick: () => void; tone?: 'red' | 'green' }) {
  const toneClass = tone === 'red' ? 'border-red/30 bg-red/10 text-red hover:bg-red/15' : tone === 'green' ? 'border-green/30 bg-green/10 text-green hover:bg-green/15' : 'border-br2 bg-s2 text-txt2 hover:bg-s3'
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12px] font-semibold transition-colors ${toneClass}`}>
      <Icon size={14} />
      {label}
    </button>
  )
}
