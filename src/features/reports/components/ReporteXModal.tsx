import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from '../../../db/repositories/settings'
import { useDayAggregation } from '../../../shared/hooks/useDayAggregation'
import { BottomSheet } from '../../../shared/components/BottomSheet'
import { PrintPortal } from '../../../shared/components/PrintPortal'
import { PrintHeader } from '../../../shared/components/PrintHeader'
import { formatMoney } from '../../../shared/lib/currency'
import { usePermission } from '../../pin/usePermission'

interface ReporteXModalProps {
  open: boolean
  dayKey: string
  onClose: () => void
}

const PAY_LABEL: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', fiado: 'Fiado' }

/** Read-only partial reading — legacy `reporteX()` (index.html L5867-5934). Reuses the exact
 * same `computeDayAggregate` numbers as Reporte and Cierre Z. */
export function ReporteXModal({ open, dayKey, onClose }: ReporteXModalProps) {
  const settings = useLiveQuery(() => getSettings())
  const agg = useDayAggregation(dayKey, { onlyOpen: false })
  const showProfit = usePermission().can('ganancias.ver')

  if (!open) return null
  const storeName = settings?.storeName ?? 'Mi Tienda Pro'

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="mb-1 flex items-center justify-between">
        <div className="font-display text-[18px] font-bold text-blue">Reporte X</div>
        <span className="rounded-full border border-blue/30 bg-blue/10 px-2.5 py-0.5 text-[11px] font-bold text-blue">LECTURA PARCIAL</span>
      </div>
      <div className="mb-3.5 text-[12px] text-muted">No cierra la caja · Solo para consulta · Acumuladores siguen activos</div>

      <div className="rounded-xl bg-s2 p-4 font-mono text-[12px] leading-[1.9]">
        <div className="text-center font-display text-[16px] text-blue">{storeName}</div>
        <div className="text-center text-[11px] text-muted">REPORTE X — Lectura Parcial · {dayKey}</div>
        <div className="my-2 border-t border-dashed border-br2" />
        <Row label="Transacciones" value={String(agg.numTx)} color="text-blue" />
        <Row label="Ventas brutas" value={formatMoney(agg.totalVentas)} color="text-green" />
        {showProfit && <Row label="Ganancia bruta" value={formatMoney(agg.totalGanancia)} color="text-lime" />}
        <Row label="Ticket promedio" value={formatMoney(agg.avgTicket)} />
        <div className="my-2 border-t border-dashed border-br2" />
        {(Object.keys(agg.payBreak) as Array<keyof typeof agg.payBreak>).map(
          (m) => agg.payBreak[m] > 0 && <Row key={m} label={PAY_LABEL[m]} value={formatMoney(agg.payBreak[m])} />,
        )}
        <div className="my-2 border-t border-dashed border-br2" />
        <Row label="Cobrado en caja" value={formatMoney(agg.cobradoReal)} color="text-green" bold />
        {agg.fiadoTotalDay > 0 && <Row label="Fiado (pendiente)" value={formatMoney(agg.fiadoTotalDay)} color="text-red" />}
        <div className="my-2 border-t border-dashed border-br2" />
        {agg.totalExOut > 0 && <Row label="Egresos de caja" value={'-' + formatMoney(agg.totalExOut)} color="text-orange" />}
        {agg.totalExIn > 0 && <Row label="Otros ingresos (abonos, etc.)" value={'+' + formatMoney(agg.totalExIn)} color="text-lime" />}
        <div className="mt-2 flex justify-between border-t border-br2 pt-2 text-[14px] font-bold">
          <span>FLUJO NETO</span>
          <span className={agg.netDay >= 0 ? 'text-lime' : 'text-red'}>{formatMoney(agg.netDay)}</span>
        </div>
      </div>
      <div className="p-2 text-center text-[11px] text-muted">
        Este reporte es solo informativo. Los acumuladores continúan activos.
        <br />
        Use el Reporte Z para el cierre definitivo.
      </div>

      <PrintPortal>
        <div className="w-[80mm] p-2 font-mono text-[11px] leading-snug text-black">
          <PrintHeader storeName={storeName} business={settings?.business} />
          <div className="text-center text-[10px]">REPORTE X — Lectura Parcial · {dayKey}</div>
          <div className="my-1 border-t border-dashed border-black" />
          <PrintRow label="Transacciones" value={String(agg.numTx)} />
          <PrintRow label="Ventas brutas" value={formatMoney(agg.totalVentas)} />
          {showProfit && <PrintRow label="Ganancia bruta" value={formatMoney(agg.totalGanancia)} />}
          <PrintRow label="Ticket promedio" value={formatMoney(agg.avgTicket)} />
          <div className="my-1 border-t border-dashed border-black" />
          {(Object.keys(agg.payBreak) as Array<keyof typeof agg.payBreak>).map(
            (m) => agg.payBreak[m] > 0 && <PrintRow key={m} label={PAY_LABEL[m]} value={formatMoney(agg.payBreak[m])} />,
          )}
          <div className="my-1 border-t border-dashed border-black" />
          <PrintRow label="Cobrado en caja" value={formatMoney(agg.cobradoReal)} bold />
          {agg.fiadoTotalDay > 0 && <PrintRow label="Fiado (pendiente)" value={formatMoney(agg.fiadoTotalDay)} />}
          <div className="my-1 border-t border-dashed border-black" />
          {agg.totalExOut > 0 && <PrintRow label="Egresos de caja" value={'-' + formatMoney(agg.totalExOut)} />}
          {agg.totalExIn > 0 && <PrintRow label="Otros ingresos (abonos, etc.)" value={'+' + formatMoney(agg.totalExIn)} />}
          <div className="mt-1 flex justify-between border-t border-black pt-1 text-[13px] font-bold">
            <span>FLUJO NETO</span>
            <span>{formatMoney(agg.netDay)}</span>
          </div>
        </div>
      </PrintPortal>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={onClose} className="rounded-[10px] border border-br2 py-2.5 text-[13px] text-txt2">
          Cerrar
        </button>
        <button onClick={() => window.print()} className="rounded-[10px] border border-blue/30 bg-blue/10 py-2.5 text-[13px] font-bold text-blue">
          Imprimir
        </button>
      </div>
    </BottomSheet>
  )
}

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className={color}>{value}</span>
    </div>
  )
}

/** Same as `Row`, minus the brand color — the printed slip is plain black on thermal paper. */
function PrintRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
