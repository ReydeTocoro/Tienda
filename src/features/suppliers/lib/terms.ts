import type { PaymentTerms } from '../../../types/supplier'

export function termsLabel(t: PaymentTerms): string {
  return t.kind === 'contado' ? 'De contado' : `Crédito a ${t.days} días`
}
