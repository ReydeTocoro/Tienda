export interface PayBreak {
  efectivo: number
  transferencia: number
  fiado: number
}

export type Cuadre = 'perfecto' | 'sobrante' | 'faltante'

export interface Arqueo {
  /** What the Caja Menor ledger said the drawer should hold. */
  efectivoSistema: number
  efectivoFisico: number
  diferencia: number
  cuadre: Cuadre
}

export interface Cierre {
  id?: number
  tipo: 'Z'
  fecha: string
  cajero: string
  cerradoEn: string
  totalVentas: number
  /** Never in the synced row — filed in "profits" (`ganancias.ver`) like a sale's profit. */
  totalGanancia?: number
  numTx: number
  /** Cash that entered outside of sales (extra income, fiado payments) / left the drawer (expenses, supplier payments). */
  totalExIn: number
  totalExOut: number
  netDay: number
  payBreak: PayBreak
  arqueo: Arqueo
  /** Moved to Caja Mayor at closing, and what stayed in the drawer for tomorrow. */
  traslado?: number
  dejadoEnCaja?: number
  sessionId?: number
  notas?: string
}
