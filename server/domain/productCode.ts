import type { CodeChangeAuditEntry } from '../../src/types/auditLog'
import type { Product } from '../../src/types/product'
import type { Sql } from '../db'
import { deleteRow, getRow, insertAutoRow, putRow } from '../routes/generic'
import { HttpError } from '../routes/http'
import { costsOf } from './secrets'

/** A product's code is the key everything else points at: its cost, a package and its loose unit, the
 * lines of the sales that sold it and of the purchase orders that ask for it. Changing it moves all
 * of that along, in the caller's transaction, so either everything follows the new code or nothing
 * changes. Carts and drafts that were holding the old code are refused by the server on checkout. */

export const MAX_CODE = 60

/** Rejects a code that another product has — scanners don't tell "abc" from "ABC", so case doesn't
 * make two codes different — or that a package has reserved for its loose unit (opening the package
 * would pour its units into that product). `except` is the product being renamed. */
export async function assertCodeFree(sql: Sql, code: string, except?: string): Promise<void> {
  const taken = await sql.query<{ code: string }>(`select code from products where lower(code) = lower($1) and ($2::text is null or code <> $2) limit 1`, [code, except ?? null])
  if (taken.length) throw new HttpError(409, 'Ese código ya existe')
  const reserved = await sql.query<{ name: string }>(`select data ->> 'name' as name from products where lower(data ->> 'codigoSuelta') = lower($1) limit 1`, [code])
  if (reserved.length) throw new HttpError(409, `Ese código está reservado para la unidad suelta de "${reserved[0].name}"`)
}

/** A key that was deleted and is in use again must not be deleted again on a device that catches up
 * late: it would replay the old deletion after downloading the new row and lose it. The old
 * deletion note is dropped; the row (new or overwritten by the download) is what counts. */
export async function reviveKey(sql: Sql, code: string): Promise<void> {
  await sql.query(`delete from deletions where table_name in ('products', 'productCosts') and pk = $1`, [code])
}

/** Moves one array of lines (`items` of a sale, `lines` of an order) from `from` to `to`. */
const MOVE_LINES = (table: string, field: string, extraWhere: string) => `
  update "${table}" set data = jsonb_set(data, '{${field}}', (
    select coalesce(jsonb_agg(case when l ->> 'code' = $1 then jsonb_set(l, '{code}', to_jsonb($2::text)) else l end order by n), '[]'::jsonb)
    from jsonb_array_elements(data -> '${field}') with ordinality as t(l, n)
  ))
  where jsonb_typeof(data -> '${field}') = 'array' and data -> '${field}' @> jsonb_build_array(jsonb_build_object('code', $1::text)) ${extraWhere}
  returning 1`

/** Changes the code of `existing` to `newCode`; `next` is the product as it should be stored (the
 * cost it may carry is the one a person allowed to see costs typed — otherwise the stored one goes
 * along unseen). `by` signs the audit entry. */
export async function renameProduct(sql: Sql, by: string, existing: Product, next: Product, newCode: string): Promise<void> {
  const old = existing.code
  await assertCodeFree(sql, newCode, old)

  // The new row first (its cost is filed under the new code by the table's trigger), then the old
  // one goes: its delete is what tells every device to forget the old code, and what removes the old cost.
  const costs = await costsOf(sql, [old])
  const stored: Product = { ...next, code: newCode }
  if (stored.cost === undefined && costs.has(old)) stored.cost = costs.get(old)
  await putRow(sql, 'products', 'code', newCode, stored)
  await deleteRow(sql, 'products', 'code', old)
  await reviveKey(sql, newCode)

  // A package and its loose unit point at each other by code.
  if (existing.esPaquete && existing.codigoSuelta) {
    const loose = await getRow<Product>(sql, 'products', 'code', existing.codigoSuelta)
    if (loose && loose.codigoPaquete === old) await putRow(sql, 'products', 'code', loose.code, { ...loose, codigoPaquete: newCode })
  }
  if (existing.esUnidadSuelta && existing.codigoPaquete) {
    const pack = await getRow<Product>(sql, 'products', 'code', existing.codigoPaquete)
    if (pack && pack.codigoSuelta === old) await putRow(sql, 'products', 'code', pack.code, { ...pack, codigoSuelta: newCode })
  }

  // Purchase orders still open must find the product when they are received; the ones already
  // received or cancelled are history and keep what they said. Every sale that sold it follows the
  // new code (they would otherwise point at a product that no longer exists — or, once the old code
  // is used again, at a different one — when an invoice is corrected).
  const pedidos = (await sql.query(MOVE_LINES('purchaseOrders', 'lines', `and data ->> 'status' in ('borrador', 'pedido')`), [old, newCode])).length
  const ventas = (await sql.query(MOVE_LINES('sales', 'items', ''), [old, newCode])).length

  const entry: Omit<CodeChangeAuditEntry, 'id'> = { type: 'cambio_codigo', date: new Date().toISOString(), oldCode: old, code: newCode, name: stored.name, user: by, ventas, pedidos }
  await insertAutoRow(sql, 'auditLog', entry)
}
