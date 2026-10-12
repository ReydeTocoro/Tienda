import type { PaymentTerms } from '../../../types/supplier'

export function termsLabel(t: PaymentTerms): string {
  return t.kind === 'contado' ? 'De contado' : `Crédito a ${t.days} días`
}

/** Colors of the payment-terms pill: credit is blue (it becomes an account payable), cash green. */
export function termsClass(t: PaymentTerms): string {
  return t.kind === 'credito' ? 'border-blue/30 bg-blue/10 text-blue' : 'border-green/30 bg-green/10 text-green'
}
