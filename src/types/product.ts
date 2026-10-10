export interface Product {
  code: string
  name: string
  /** Price per selling unit — "per kg"/"per lb" when `unit` is measured, "per unidad" otherwise.
   * One field for both: a measured product has no separate "total" price to duplicate it with.
   * This is "Precio 1", the one every screen uses until the cashier picks another (see `price2`). */
  price: number
  /** "Precio 2" and "Precio 3": optional extra selling prices of the same product (wholesale, regular
   * customers…), per the same unit as `price`. Absent = not set, never 0. The cashier picks which one
   * to charge on the cart line; the server accepts a sale line at any of the product's prices
   * (src/shared/lib/prices.ts). */
  price2?: number
  price3?: number
  /** Purchase price. Never in the row every device syncs: the database files it in "productCosts",
   * which only whoever may see purchase prices (`costos.ver`) receives. Present on a product only
   * where the app merged it in for them (`useProductCosts`), and on writes from them. */
  cost?: number
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
