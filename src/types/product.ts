export interface Product {
  code: string
  name: string
  price: number
  cost: number
  stock: number
  min: number
  cat: string
  brand: string
  unit: string
  /** Only meaningful when `unit` is a measured (non-count) unit. */
  pricePer: number

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
