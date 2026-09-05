import { useCartStore } from '../../../store/useCartStore'
import { finalizeSale } from '../../../db/repositories/sales'
import { computeCartDiscount } from '../../../shared/lib/loyalty'
import { toast } from '../../../store/useToastStore'
import type { Sale } from '../../../types/sale'

/** Cart subtotal/discount/total — `loyaltyPts` is 0 until Fase 4 wires the customer picker
 * back into Venta (per the plan, loyalty stays stubbed until then). */
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
    const loyaltyPts = 0 // Fase 4 will pass the real customer points here
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
