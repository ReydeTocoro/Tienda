import { db } from '../../../db/index'
import { useCartStore } from '../../../store/useCartStore'
import { finalizeSale } from '../../../db/repositories/sales'
import { computeCartDiscount, getPts } from '../../../shared/lib/loyalty'
import { toast } from '../../../store/useToastStore'
import type { Sale } from '../../../types/sale'

/** Cart subtotal/discount/total, plus the cash-register charge amount (defaults to `total`,
 * overridden when the cashier types a different "Total a cobrar" — see `chargeOverride`).
 * Pass the selected customer's live points (see `useSelectedCustomerLoyalty`) — 0 when no
 * customer is picked. */
export function useCartTotals(loyaltyPts = 0) {
  const items = useCartStore((s) => s.items)
  const manualDiscountPct = useCartStore((s) => s.manualDiscountPct)
  const chargeOverride = useCartStore((s) => s.chargeOverride)
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0)
  const { amount: discount, label: discountLabel } = computeCartDiscount(subtotal, loyaltyPts, manualDiscountPct)
  const total = subtotal - discount
  const chargeAmount = chargeOverride ?? total
  const roundingAdjustment = chargeAmount - total
  return { subtotal, discount, discountLabel, total, chargeAmount, roundingAdjustment }
}

/** Ports `finalizeSale()` (legacy index.html L3359-3415) onto the Dexie transaction in
 * `db/repositories/sales.ts`. */
export function useFinalizeSale() {
  return async function finalize(): Promise<Sale | null> {
    const cart = useCartStore.getState()
    if (!cart.items.length) {
      toast('Carrito vacío', 'orange')
      return null
    }
    if (cart.payMethod === 'fiado' && !cart.fiadoName.trim() && !cart.customerId) {
      toast('Escribe el nombre del cliente fiado', 'orange')
      return null
    }

    const subtotal = cart.items.reduce((a, i) => a + i.price * i.qty, 0)
    const custSales = cart.customerId ? await db.sales.where('customerId').equals(cart.customerId).toArray() : []
    const loyaltyPts = cart.customerId ? getPts(custSales, cart.customerId) : 0
    const { amount: discount } = computeCartDiscount(subtotal, loyaltyPts, cart.manualDiscountPct)
    const total = subtotal - discount
    const chargeAmount = cart.chargeOverride ?? total
    const roundingAdjustment = chargeAmount - total

    if (cart.payMethod === 'efectivo' && cart.amountReceived > 0 && cart.amountReceived < chargeAmount) {
      toast('El efectivo recibido no alcanza el total', 'orange')
      return null
    }

    const isCash = cart.payMethod === 'efectivo' && cart.amountReceived > 0
    let sale: Sale
    try {
      sale = await finalizeSale({
        items: cart.items,
        subtotal,
        discount,
        total: chargeAmount,
        roundingAdjustment: roundingAdjustment !== 0 ? roundingAdjustment : undefined,
        amountReceived: isCash ? cart.amountReceived : undefined,
        changeGiven: isCash ? cart.amountReceived - chargeAmount : undefined,
        payMethod: cart.payMethod,
        customerId: cart.customerId,
        customerName: cart.customerName,
        fiadoName: cart.payMethod === 'fiado' ? cart.customerName ?? cart.fiadoName.trim() : undefined,
        notes: cart.notes.trim() || undefined,
      })
    } catch (err) {
      // The server re-checks stock at finalize time (two devices could sell the same last kg at
      // once) — this is the one place that rejection actually surfaces to the cashier.
      toast(err instanceof Error ? err.message : String(err), 'orange')
      return null
    }

    cart.clear()
    toast('Venta registrada', 'green')
    return sale
  }
}
