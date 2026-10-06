import type { Sql } from '../db'

/** Reading the secret fields the database keeps out of the public rows (see the migration
 * 20261005000000_permisos_servidor.sql): a product's purchase price lives in "productCosts", a
 * sale's or cierre's profit in "profits". Writing them needs nothing special — a row written with
 * `cost` / `ganancia` / `totalGanancia` is split by the tables' triggers. */

export async function costsOf(sql: Sql, codes: string[]): Promise<Map<string, number>> {
  if (!codes.length) return new Map()
  const rows = await sql.query<{ code: string; cost: number | null }>(
    `select code, (data ->> 'cost')::float8 as cost from "productCosts" where code = any($1)`,
    [[...new Set(codes)]],
  )
  return new Map(rows.map((r) => [r.code, Number(r.cost) || 0]))
}

/** A product's purchase price, 0 when it never had one. */
export async function costOf(sql: Sql, code: string): Promise<number> {
  return (await costsOf(sql, [code])).get(code) ?? 0
}

/** The cost of a loose unit carved out of a package: the package's cost split evenly. */
export async function looseUnitCost(sql: Sql, packageCode: string, units: number): Promise<number> {
  const cost = await costOf(sql, packageCode)
  return cost > 0 ? +(cost / (units || 1)).toFixed(2) : 0
}

/** Profit of each sale, by sale id. */
export async function saleProfits(sql: Sql, saleIds: number[]): Promise<Map<number, number>> {
  if (!saleIds.length) return new Map()
  const rows = await sql.query<{ id: string; ganancia: number | null }>(
    `select data ->> 'refId' as id, (data ->> 'ganancia')::float8 as ganancia from profits where key = any($1)`,
    [saleIds.map((id) => `sale:${id}`)],
  )
  return new Map(rows.map((r) => [Number(r.id), Number(r.ganancia) || 0]))
}
