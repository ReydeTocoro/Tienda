import { db } from '../../../db/index'
import { useCartStore } from '../../../store/useCartStore'
import { finalizeSale } from '../../../db/repositories/sales'
import { computeCartDiscount, getPts } from '../../../shared/lib/loyalty'
import { toast } from '../../../store/useToastStore'
import type { Sale } from '../../../types/sale'

/** Cart subtotal/discount/total. Pass the selected customer's live points (see
 * `useSelectedCustomerLoyalty`) — 0 when no customer is picked. */
export function useCartTotals(loyaltyPts = 0) {
  const items = useCartStore((s) => s.items)
  const manualDiscountPct = useCartStore((s) => s.manualDiscountPct)
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0)
  const { amount: discount, label: discountLabel } = computeCartDiscount(subtotal, loyaltyPts, manualDiscountPct)
  const total = subtotal - discount
  return { subtotal, discount, discountLabel, total }
}

/** Ports `finalizeSale()` (legacy index.html L3359-3415) onto the Dexie transaction in
 * `db/repositories/sales.ts`. */
export function useFinalizeSale() {
  return async function finalize(): Promise<Sale | null> {
    const cart = useCartStore.getState()
    if (!cart.items.length) {
      toast('⚠ Carrito vacío', 'orange')
      return null
    }
    if (cart.payMethod === 'fiado' && !cart.fiadoName.trim() && !cart.customerId) {
      toast('⚠ Escribe el nombre del cliente fiado', 'orange')
      return null
    }

    const subtotal = cart.items.reduce((a, i) => a + i.price * i.qty, 0)
    const custSales = cart.customerId ? await db.sales.where('customerId').equals(cart.customerId).toArray() : []
    const loyaltyPts = cart.customerId ? getPts(custSales, cart.customerId) : 0
    const { amount: discount } = computeCartDiscount(subtotal, loyaltyPts, cart.manualDiscountPct)
    const total = subtotal - discount

    const sale = await finalizeSale({
      items: cart.items,
      subtotal,
      discount,
      total,
      payMethod: cart.payMethod,
      customerId: cart.customerId,
      customerName: cart.customerName,
      fiadoName: cart.payMethod === 'fiado' ? cart.customerName ?? cart.fiadoName.trim() : undefined,
      notes: cart.notes.trim() || undefined,
    })

    cart.clear()
    toast('✓ Venta registrada', 'green')
    return sale
  }
}
