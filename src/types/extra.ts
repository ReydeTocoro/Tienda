export type ExtraType = 'ingreso' | 'egreso'

export interface Extra {
  id?: number
  desc: string
  amount: number
  type: ExtraType
  date: string
  dayKey: string
  closedInCierreId?: number
}
