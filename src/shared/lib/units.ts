import { findUnit } from '../../types/unit'

/** Short/abbreviated labels — legacy `UNIT_LABELS` (index.html L3567-3573). */
const SHORT_OVERRIDES: Record<string, string> = {
  unidad: 'uds',
  docena: 'doc',
  caja: 'caja',
  paquete: 'paq',
  par: 'par',
  m2: 'm²',
  ft2: 'ft²',
}

export function unitShortLabel(unit: string): string {
  return SHORT_OVERRIDES[unit] ?? unit
}

/** Full display name — legacy `UNIT_NAMES` (index.html L3574-3580), backed by `UNITS[].label`. */
export function unitFullName(unit: string): string {
  return findUnit(unit)?.label ?? unit
}

export { UNITS, COUNTED_UNITS, isMeasuredUnit, getUnitConversions, convert, findUnit } from '../../types/unit'
