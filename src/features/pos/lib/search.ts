import type { Product } from '../../../types/product'

/** Ported from legacy `renderDropdown()` matching rules (index.html L2404-2410). */
export function searchMatches(products: Product[], query: string, limit = 12): Product[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return products
    .filter(
      (p) =>
        p.code.toLowerCase().startsWith(q) ||
        p.code.toLowerCase() === q ||
        p.name.toLowerCase().includes(q) ||
        (p.brand && p.brand.toLowerCase().includes(q)) ||
        (p.cat && p.cat.toLowerCase().includes(q)),
    )
    .slice(0, limit)
}
