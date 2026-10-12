import { isServerTrouble } from '../../../api/client'
import { selectActiveCart, useActiveCart, useCartStore } from '../../../store/useCartStore'
import { finalizeSale, type FinalizeSaleInput } from '../../../db/repositories/sales'
import { saveSaleOffline } from '../../../offline/outbox'
import { newClientId } from '../../../shared/lib/id'
import { lineDiscount, manualDiscountOf } from '../../../shared/lib/discounts'
import { useConnectionStore } from '../../../store/useConnectionStore'
import { toast } from '../../../store/useToastStore'
import type { Sale } from '../../../types/sale'

/** Active cart's subtotal/discount/total, plus the cash-register charge amount (defaults to `total`,
 * overridden when the cashier types a different "Total a cobrar" — see `chargeOverride`). The discount is what
 * was typed on the lines, in money. */
export function useCartTotals() {
  const items = useActiveCart((c) => c.items)
  const chargeOverride = useActiveCart((c) => c.chargeOverride)
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0)
  const discount = manualDiscountOf(items)
  const total = subtotal - discount
  const chargeAmount = chargeOverride ?? total
  const roundingAdjustment = chargeAmount - total
  return { subtotal, discount, total, chargeAmount, roundingAdjustment }
}

/** Carts whose sale is being saved right now. The cart only empties once the server answers (seconds when
 * the Function was asleep), and until then Cobrar still works: a second charge of the same cart would be
 * a second sale — twice the money in the caja and the stock taken twice — which the server can't tell
 * from a new one. */
const charging = new Set<string>()

/** Ports `finalizeSale()` (legacy index.html L3359-3415) onto the Dexie transaction in
 * `db/repositories/sales.ts`. */
export function useFinalizeSale() {
  return async function finalize(): Promise<Sale | null> {
    // Which cart is being charged is fixed right here, before any await: charging takes a moment
    // (the server's stock check) and the cashier may switch to another customer's
    // cart meanwhile. Only THIS cart must go when the sale is saved — never "whichever is open".
    const cartId = useCartStore.getState().activeId
    if (charging.has(cartId)) {
      toast('Esta venta ya se está guardando: espera un momento', 'blue')
      return null
    }
    charging.add(cartId)
    try {
      return await charge(cartId)
    } finally {
      charging.delete(cartId)
    }
  }
}

async function charge(cartId: string): Promise<Sale | null> {
  const cart = selectActiveCart(useCartStore.getState())
  if (!cart.items.length) {
    toast('Carrito vacío', 'orange')
    return null
  }
  if (cart.payMethod === 'fiado' && !cart.fiadoName.trim() && !cart.customerId) {
    toast('Escribe el nombre del cliente fiado', 'orange')
    return null
  }

  const subtotal = cart.items.reduce((a, i) => a + i.price * i.qty, 0)
  const discount = manualDiscountOf(cart.items)
  const total = subtotal - discount
  const chargeAmount = cart.chargeOverride ?? total
  const roundingAdjustment = chargeAmount - total

  // The Cobrar sheet already keeps its button off until this holds; it is checked here too so no way of charging skips it.
  if (cart.payMethod === 'efectivo' && chargeAmount > 0 && cart.amountReceived < chargeAmount) {
    toast(cart.amountReceived > 0 ? 'El efectivo recibido no alcanza el total' : 'Indica con cuánto paga el cliente', 'orange')
    return null
  }

  if (cart.payMethod === 'transferencia' && chargeAmount > 0 && !cart.transferAccount) {
    toast('Elige la cuenta a la que llegó la transferencia', 'orange')
    return null
  }

  const isCash = cart.payMethod === 'efectivo' && cart.amountReceived > 0
  const input: FinalizeSaleInput & { clientId: string } = {
    // Its own code from the moment it is charged: if the answer gets lost on a bad connection and the sale is
    // kept here to be sent later, the server knows it is the same sale (and never saves it twice).
    clientId: newClientId(),
    // Each line carries the money taken off it (cut to what the line is worth, to the cent).
    items: cart.items.map((i) => {
      const d = Math.round(lineDiscount(i) * 100) / 100
      return { ...i, discount: d > 0 ? d : undefined }
    }),
    subtotal,
    discount,
    total: chargeAmount,
    roundingAdjustment: roundingAdjustment !== 0 ? roundingAdjustment : undefined,
    amountReceived: isCash ? cart.amountReceived : undefined,
    changeGiven: isCash ? cart.amountReceived - chargeAmount : undefined,
    payMethod: cart.payMethod,
    transferAccount: cart.payMethod === 'transferencia' ? cart.transferAccount : undefined,
    customerId: cart.customerId,
    customerName: cart.customerName,
    fiadoName: cart.payMethod === 'fiado' ? cart.customerName ?? cart.fiadoName.trim() : undefined,
    notes: cart.notes.trim() || undefined,
  }
  let sale: Sale
  let kept = false
  try {
    ;({ sale, kept } = await sell(input))
  } catch (err) {
    // The server re-checks stock at finalize time (two devices could sell the same last kg at
    // once) — this is the one place that rejection actually surfaces to the cashier.
    toast(err instanceof Error ? err.message : String(err), 'orange')
    return null
  }

  useCartStore.getState().closeCart(cartId)
  if (kept) toast('Venta guardada sin internet: se enviará sola', 'orange')
  else toast('Venta registrada', 'green')
  return sale
}

/** How long the server gets to take a sale before it is kept on this device instead. The customer is waiting at
 * the till, and a server that hasn't answered in this long probably won't: if it does after all (the answer was
 * only slow), the sale's own code makes the later sending a no-op. */
const SERVER_PATIENCE_MS = 10_000

/** Charges the sale on the server — or, when the server can't be reached, keeps it on this device (src/offline)
 * so the till never stops: it is already off the shelf here, and goes up by itself when the internet is back.
 * A sale the server REFUSES (no stock, no permission…) is not kept: the cashier has to know it did not happen. */
async function sell(input: FinalizeSaleInput & { clientId: string }): Promise<{ sale: Sale; kept: boolean }> {
  if (useConnectionStore.getState().reachable) {
    try {
      return { sale: await finalizeSale(input, { timeoutMs: SERVER_PATIENCE_MS }), kept: false }
    } catch (err) {
      if (!isServerTrouble(err)) throw err
    }
  }
  return { sale: await saveSaleOffline(input), kept: true }
}
