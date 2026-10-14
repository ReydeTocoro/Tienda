import type { Product } from '../../types/product'
import { apiPost, apiPut, apiDelete } from '../../api/client'

/** Insert a brand-new product. Throws if the code already exists (server returns 409). */
export async function addProduct(product: Product): Promise<void> {
  await apiPost('/api/products', product)
}

/** Update an existing product in place. `code` is the one it has now; if `product.code` is a different
 * one, the server changes the product's code (its sales and open orders follow). `keepStock`: the stock
 * isn't sent, so the server leaves the live one — the figure a form loaded may be stale by the time it's saved.
 * `stockReason`: why the stock changes, for the audit trail. */
export async function updateProduct(code: string, product: Product, opts: { keepStock?: boolean; stockReason?: string } = {}): Promise<void> {
  await apiPut(`/api/products/${encodeURIComponent(code)}`, opts.keepStock ? { ...product, stock: undefined } : { ...product, stockReason: opts.stockReason })
}

export async function deleteProduct(code: string): Promise<void> {
  await apiDelete(`/api/products/${encodeURIComponent(code)}`)
}

/** Adjust stock by a signed delta, clamped at 0, saying why (the audit trail keeps it with who did it). */
export async function adjustStock(code: string, delta: number, reason: string): Promise<number> {
  const updated = await apiPost<Product>(`/api/products/${encodeURIComponent(code)}/adjust-stock`, { delta, reason })
  return updated.stock
}
