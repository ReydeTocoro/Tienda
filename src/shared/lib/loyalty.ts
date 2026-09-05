import type { Sale } from '../../types/sale'

export type TierKey = 'nuevo' | 'bronce' | 'plata' | 'oro'

export interface Tier {
  key: TierKey
  label: string
  badgeClass: string
  avatarClass: string
}

/** Ported 1:1 from legacy `tier()` (index.html L2358-2363). */
export function tier(spent: number): Tier {
  if (spent >= 5000) return { key: 'oro', label: '🥇 Oro', badgeClass: 'border-[#ffd70045] bg-[#ffd70018] text-[#ffd700]', avatarClass: 'border-[#ffd70035] bg-[#ffd70012] text-[#ffd700]' }
  if (spent >= 1000) return { key: 'plata', label: '🥈 Plata', badgeClass: 'border-[#c0c0c045] bg-[#c0c0c018] text-[#c0c0c0]', avatarClass: 'border-[#c0c0c035] bg-[#c0c0c012] text-[#c0c0c0]' }
  if (spent >= 200) return { key: 'bronce', label: '🥉 Bronce', badgeClass: 'border-[#cd7f3245] bg-[#cd7f3218] text-[#cd7f32]', avatarClass: 'border-[#cd7f3235] bg-[#cd7f3212] text-[#cd7f32]' }
  return { key: 'nuevo', label: '⭐ Nuevo', badgeClass: 'border-blue/30 bg-blue/10 text-blue', avatarClass: 'border-blue/35 bg-blue/10 text-blue' }
}

/** Lifetime spend for a customer — legacy `getSpent()` (index.html L2364-2369), minus the
 * ad-hoc memo cache (Dexie + useLiveQuery already avoid the recompute-on-every-render cost). */
export function getSpent(sales: Sale[], customerId: string): number {
  return sales.filter((s) => s.customerId === customerId).reduce((a, s) => a + s.total, 0)
}

/** 1 point per $10 of lifetime spend — legacy `getPts()` (index.html L2370). */
export function getPts(sales: Sale[], customerId: string): number {
  return Math.floor(getSpent(sales, customerId) / 10)
}

export function getCustomerSales(sales: Sale[], customerId: string): Sale[] {
  return sales.filter((s) => s.customerId === customerId)
}

/** Loyalty discount: unlocked at 50pts, capped at min(5% of subtotal, points × $0.50).
 * Legacy: index.html L3078-3081 / L3367. */
export function loyaltyDiscount(subtotal: number, pts: number): number {
  if (pts < 50) return 0
  return Math.min(subtotal * 0.05, pts * 0.5)
}

/** The manual discount never *stacks* with the loyalty discount — the higher of the two wins
 * (legacy L3084-3088 in renderCart, L3369-3370 in finalizeSale). */
export function computeCartDiscount(subtotal: number, loyaltyPts: number, manualDiscountPct: number): { amount: number; label: 'loyalty' | 'manual' | null } {
  const loyalty = loyaltyDiscount(subtotal, loyaltyPts)
  const manual = manualDiscountPct > 0 ? subtotal * (manualDiscountPct / 100) : 0
  if (manual >= loyalty && manual > 0) return { amount: manual, label: 'manual' }
  if (loyalty > 0) return { amount: loyalty, label: 'loyalty' }
  return { amount: 0, label: null }
}
