import type { Sale } from '../../types/sale'

/** What a customer has bought in all: the total of their sales, leaving out the annulled ones. */
export function getSpent(sales: Sale[], customerId: string): number {
  return sales.filter((s) => s.customerId === customerId && !s.voided).reduce((a, s) => a + s.total, 0)
}
