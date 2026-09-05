import { db } from '../index'
import type { Product } from '../../types/product'

export async function getProduct(code: string): Promise<Product | undefined> {
  return db.products.get(code)
}

export async function upsertProduct(product: Product): Promise<void> {
  await db.products.put(product)
}

export async function deleteProduct(code: string): Promise<void> {
  await db.products.delete(code)
}
