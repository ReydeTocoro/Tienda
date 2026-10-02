import type { OrderStatus } from '../../../types/purchaseOrder'

export const ORDER_STATUS: Record<OrderStatus, { label: string; cls: string }> = {
  borrador: { label: 'Borrador', cls: 'border-br2 bg-s2 text-txt2' },
  pedido: { label: 'Pedido enviado', cls: 'border-blue/30 bg-blue/10 text-blue' },
  recibido: { label: 'Recibido', cls: 'border-green/30 bg-green/10 text-green' },
  cancelado: { label: 'Cancelado', cls: 'border-red/30 bg-red/10 text-red' },
}
