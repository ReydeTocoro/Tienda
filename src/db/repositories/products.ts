import { db } from '../index'
import type { Product } from '../../types/product'
import { apiPost, apiPut, apiDelete } from '../../api/client'

export async function getProduct(code: string): Promise<Product | undefined> {
  return db.products.get(code)
}

export async function listProducts(): Promise<Product[]> {
  return db.products.toArray()
}

/** Insert a brand-new product. Throws if the code already exists (server returns 409). */
export async function addProduct(product: Product): Promise<void> {
  await apiPost('/api/products', product)
}

/** Update an existing product in place. `code` is the one it has now; if `product.code` is a different
 * one, the server changes the product's code (its sales and open orders follow). */
export async function updateProduct(code: string, product: Product): Promise<void> {
  await apiPut(`/api/products/${encodeURIComponent(code)}`, product)
}

export async function upsertProduct(product: Product): Promise<void> {
  await apiPut(`/api/products/${encodeURIComponent(product.code)}`, product)
}

export async function deleteProduct(code: string): Promise<void> {
  await apiDelete(`/api/products/${encodeURIComponent(code)}`)
}

/** Adjust stock by a signed delta, clamped at 0 (legacy `quickStock`). */
export async function adjustStock(code: string, delta: number): Promise<number> {
  const updated = await apiPost<Product>(`/api/products/${encodeURIComponent(code)}/adjust-stock`, { delta })
  return updated.stock
}
