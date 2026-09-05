import { db } from '../index'
import type { Product } from '../../types/product'

export async function getProduct(code: string): Promise<Product | undefined> {
  return db.products.get(code)
}

export async function listProducts(): Promise<Product[]> {
  return db.products.toArray()
}

/** Insert a brand-new product. Throws if the code already exists (legacy L3690). */
export async function addProduct(product: Product): Promise<void> {
  const existing = await db.products.get(product.code)
  if (existing) throw new Error('Ese código ya existe')
  await db.products.add(product)
}

/** Update an existing product in place (code is the primary key and cannot change). */
export async function updateProduct(product: Product): Promise<void> {
  await db.products.put(product)
}

export async function upsertProduct(product: Product): Promise<void> {
  await db.products.put(product)
}

export async function deleteProduct(code: string): Promise<void> {
  await db.products.delete(code)
}

/** Adjust stock by a signed delta, clamped at 0 (legacy `quickStock`, L4116-4124). */
export async function adjustStock(code: string, delta: number): Promise<number> {
  return db.transaction('rw', db.products, async () => {
    const p = await db.products.get(code)
    if (!p) throw new Error('Producto no encontrado')
    const next = Math.max(0, (p.stock || 0) + delta)
    await db.products.update(code, { stock: next })
    return next
  })
}
