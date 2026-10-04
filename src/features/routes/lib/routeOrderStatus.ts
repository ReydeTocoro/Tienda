import type { RouteOrderStatus } from '../../../types/routeOrder'

export const ROUTE_ORDER_STATUS: Record<RouteOrderStatus, { label: string; cls: string }> = {
  tomado: { label: 'Tomado', cls: 'border-blue/30 bg-blue/10 text-blue' },
  preparado: { label: 'Preparado', cls: 'border-orange/30 bg-orange/10 text-orange' },
  entregado: { label: 'Entregado', cls: 'border-green/30 bg-green/10 text-green' },
  cancelado: { label: 'Cancelado', cls: 'border-red/30 bg-red/10 text-red' },
}
