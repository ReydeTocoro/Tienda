import { useLiveQuery } from 'dexie-react-hooks'
import { ShoppingCart, Package, Users, ClipboardList, Receipt, BarChart3, Settings, Wallet, Truck } from 'lucide-react'
import type { ComponentType } from 'react'
import { db } from '../db/index'
import { useSecureTable } from '../db/secure'
import { groupFiados, groupTotals } from '../features/fiados/lib/fiadoGrouping'
import { payableBalance } from '../shared/lib/cash'
import { todayKey } from '../shared/lib/currency'
import type { Need } from '../shared/lib/permissions'
import { useMemo } from 'react'

export interface NavItem {
  to: string
  label: string
  icon: ComponentType<{ size?: number; className?: string }>
  end?: boolean
  /** Label for the cramped mobile bottom bar, when the full one doesn't fit. */
  shortLabel?: string
  badgeKey?: 'lowStock' | 'fiados' | 'payables'
  /** Permission needed to enter (see src/shared/lib/permissions.ts); absent = everyone (Venta). */
  need?: Need
  /** Full name for the PIN prompt, when `label` is abbreviated. */
  title?: string
}

/** Shared between `BottomNav` (mobile) and `DesktopTabs` (desktop) so both chromes stay in sync,
 * and by the router's `ModuleGate`s. Every module is listed for everyone; one the current person
 * can't enter shows a lock and asks for the PIN of someone who can. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Venta', icon: ShoppingCart, end: true },
  { to: '/inventario', label: 'Stock', icon: Package, badgeKey: 'lowStock', need: 'stock.ver' },
  { to: '/clientes', label: 'Clientes', icon: Users, need: 'clientes.ver' },
  { to: '/fiados', label: 'Fiados', icon: ClipboardList, badgeKey: 'fiados', need: 'fiados.ver' },
  { to: '/facturas', label: 'Facturas', icon: Receipt, need: 'facturas.ver' },
  { to: '/cajas', label: 'Cajas', icon: Wallet, need: 'caja.gestionar' },
  { to: '/proveedores', label: 'Proveedores', shortLabel: 'Proveed.', icon: Truck, badgeKey: 'payables', need: 'proveedores.gestionar' },
  { to: '/reporte', label: 'Reporte', icon: BarChart3, need: 'reportes.ver' },
  { to: '/configuracion', label: 'Config.', title: 'Configuración', icon: Settings, need: 'admin' },
]

/** Text of the PIN prompt shown when someone without access opens a module. */
export function gateText(item: NavItem): { title: string; subtitle: string } {
  const name = item.title ?? item.label
  return {
    title: name,
    subtitle: item.need === 'admin' ? `${name} es solo para el Administrador. Ingresa tu PIN.` : `Para entrar a ${name}, ingresa el PIN de alguien con permiso.`,
  }
}

/** Live low-stock / pending-fiado counts used for nav badges in both chromes. */
export function useNavBadges() {
  const lowStockCount = useLiveQuery(() => db.products.filter((p) => p.stock > 0 && p.min > 0 && p.stock <= p.min).count(), [], 0)
  const fiadoCount = useLiveQuery(
    () => db.sales.toArray().then((sales) => groupFiados(sales).filter((g) => groupTotals(g).totalDebt > 0).length),
    [],
    0,
  )
  // Supplier debts already past their due date (only known to whoever may see purchasing).
  const payables = useSecureTable('payables')
  const overdueCount = useMemo(() => {
    const today = todayKey()
    return payables.filter((p) => payableBalance(p) > 0 && p.dueDate < today).length
  }, [payables])
  return { lowStock: lowStockCount, fiados: fiadoCount, payables: overdueCount }
}
