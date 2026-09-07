import type { ParsedImportRow, DupAction } from '../../features/inventory/lib/importProducts'
import { apiPost } from '../../api/client'

/** Convert `qty` packages into loose units, creating the loose-unit sibling product the first
 * time it's opened. Legacy `confirmarAbrirPaquete()`. */
export async function openPackage(packageCode: string, qty: number): Promise<{ sueltaName: string; nuevasSueltas: number }> {
  return apiPost('/api/inventory/open-package', { code: packageCode, qty })
}

/** "Vender unidad suelta" quick action from the package card — auto-opens a package if no
 * loose units remain. Legacy `veredaVenderUnidad()`. Note: like the legacy app, this is a
 * direct stock adjustment, not a POS sale (no `sales` row is created). */
export async function sellLooseUnit(packageCode: string): Promise<void> {
  await apiPost('/api/inventory/sell-loose-unit', { code: packageCode })
}

/** "Vender paquete completo" quick action — legacy `veredaVenderPaquete()`. */
export async function sellWholePackage(packageCode: string): Promise<void> {
  await apiPost('/api/inventory/sell-whole-package', { code: packageCode })
}

export interface CyclicCountAdjustment {
  code: string
  counted: number
  reason: string
}

/** Apply conteo cíclico differences, logging each one to the audit trail — legacy
 * `aplicarAjustesConteo()`. */
export async function applyCyclicCountAdjustments(adjustments: CyclicCountAdjustment[], user: string): Promise<number> {
  const { applied } = await apiPost<{ applied: number }>('/api/inventory/cyclic-count', { adjustments, user })
  return applied
}

export interface ImportSummary {
  added: number
  updated: number
  skipped: number
}

/** Commit a previewed import — legacy `confirmImport()`. */
export async function applyImport(parsed: ParsedImportRow[], dupAction: DupAction): Promise<ImportSummary> {
  return apiPost<ImportSummary>('/api/inventory/import', { parsed, dupAction })
}
