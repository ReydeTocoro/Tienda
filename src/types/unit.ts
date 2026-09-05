export type UnitFamily = 'count' | 'weight' | 'volume' | 'length' | 'area'

export interface UnitDef {
  value: string
  label: string
  family: UnitFamily
  /** Factor to convert 1 of this unit into the base unit of its family. Absent for count units (not convertible). */
  toBase?: number
}

export const UNITS: UnitDef[] = [
  { value: 'unidad', label: 'Unidad', family: 'count' },
  { value: 'docena', label: 'Docena', family: 'count' },
  { value: 'caja', label: 'Caja', family: 'count' },
  { value: 'paquete', label: 'Paquete', family: 'count' },
  { value: 'par', label: 'Par', family: 'count' },

  { value: 'kg', label: 'Kilogramo', family: 'weight', toBase: 1000 },
  { value: 'g', label: 'Gramo', family: 'weight', toBase: 1 },
  { value: 'lb', label: 'Libra', family: 'weight', toBase: 453.59237 },
  { value: 'oz', label: 'Onza', family: 'weight', toBase: 28.349523125 },
  { value: 't', label: 'Tonelada', family: 'weight', toBase: 1_000_000 },

  { value: 'L', label: 'Litro', family: 'volume', toBase: 1000 },
  { value: 'ml', label: 'Mililitro', family: 'volume', toBase: 1 },
  { value: 'gal', label: 'Galón', family: 'volume', toBase: 3785.411784 },
  { value: 'fl_oz', label: 'Onza líquida', family: 'volume', toBase: 29.5735295625 },

  { value: 'm', label: 'Metro', family: 'length', toBase: 1000 },
  { value: 'cm', label: 'Centímetro', family: 'length', toBase: 10 },
  { value: 'mm', label: 'Milímetro', family: 'length', toBase: 1 },
  { value: 'ft', label: 'Pie', family: 'length', toBase: 304.8 },
  { value: 'in', label: 'Pulgada', family: 'length', toBase: 25.4 },
  { value: 'yd', label: 'Yarda', family: 'length', toBase: 914.4 },

  { value: 'm2', label: 'Metro cuadrado', family: 'area', toBase: 1 },
  { value: 'ft2', label: 'Pie cuadrado', family: 'area', toBase: 0.09290304 },
]

export const COUNTED_UNITS = new Set(['unidad', 'docena', 'caja', 'paquete', 'par'])

export function isMeasuredUnit(unit: string): boolean {
  return !COUNTED_UNITS.has(unit)
}

export function findUnit(value: string): UnitDef | undefined {
  return UNITS.find((u) => u.value === value)
}

/** All other units in the same convertible family as `unit` (empty for count units). */
export function getUnitConversions(unit: string): UnitDef[] {
  const def = findUnit(unit)
  if (!def || def.toBase === undefined) return []
  return UNITS.filter((u) => u.family === def.family && u.value !== unit)
}

/** Convert a value between two units of the same measured family. Returns null if not convertible. */
export function convert(value: number, from: string, to: string): number | null {
  const a = findUnit(from)
  const b = findUnit(to)
  if (!a || !b || a.toBase === undefined || b.toBase === undefined || a.family !== b.family) return null
  return (value * a.toBase) / b.toBase
}
