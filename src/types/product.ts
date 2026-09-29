export interface Product {
  code: string
  name: string
  /** Price per selling unit — "per kg"/"per lb" when `unit` is measured, "per unidad" otherwise.
   * One field for both: a measured product has no separate "total" price to duplicate it with. */
  price: number
  cost: number
  stock: number
  min: number
  cat: string
  brand: string
  unit: string

  /** True when this product is sold as a sealed package that can be "opened" into loose units. */
  esPaquete: boolean
  unidadesPor?: number
  codigoSuelta?: string
  nombreSuelta?: string
  precioSuelta?: number

  /** True when this row was auto-generated the first time a package (see codigoPaquete) was opened. */
  esUnidadSuelta?: boolean
  codigoPaquete?: string
  nombrePaquete?: string

  createdAt?: string
}
