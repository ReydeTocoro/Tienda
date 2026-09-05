export interface PayBreak {
  efectivo: number
  transferencia: number
  fiado: number
}

export type Cuadre = 'perfecto' | 'sobrante' | 'faltante'

export interface Arqueo {
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
  totalGanancia: number
  numTx: number
  totalCompras: number
  totalExIn: number
  totalExOut: number
  netDay: number
  payBreak: PayBreak
  arqueo: Arqueo
  notas?: string
}
