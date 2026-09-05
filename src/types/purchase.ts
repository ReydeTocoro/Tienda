export interface PurchaseItem {
  name: string
  qty: number
  price: number
}

export interface Purchase {
  id?: number
  items: PurchaseItem[]
  desc: string
  total: number
  date: string
  dayKey: string
  closedInCierreId?: number
}
