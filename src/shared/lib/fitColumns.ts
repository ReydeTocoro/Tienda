/** Which of a list's columns to show in `room` pixels (the table's own width). A column with a `drop`
 * number may be left out, the lowest number first, but only as many as it takes to fit — and only if
 * that really makes the rest fit: when even without all of them the list is wider than the screen
 * (a phone), it keeps every column and scrolls sideways, as it always has. */
export function fitColumns<C extends { min: number; drop?: number }>(columns: C[], room: number | null): C[] {
  const width = (list: C[]) => list.reduce((sum, c) => sum + c.min, 0)
  if (room === null || width(columns) <= room) return columns
  let shown = columns
  for (const c of columns.filter((x) => x.drop !== undefined).sort((a, b) => a.drop! - b.drop!)) {
    shown = shown.filter((x) => x !== c)
    if (width(shown) <= room) return shown
  }
  return columns
}
