/** Hand ordering for the enrichment heatmap figure: drag a row or column
 * label to a new place, or click a column label to sort the rows by it.
 *
 * The result is stored as the figure's `row_custom_order` /
 * `col_custom_order` params (with `row_order` / `col_order` = 'custom'), and
 * the backend applies it the same way (`enrichment_figures._custom_first`).
 * `permuteHeatmap` applies it to data already in the browser, so a drop
 * redraws at once instead of waiting for the debounced preview fetch. */
import type { EnrichmentHeatmapData } from './figures'

/** The gap a pointer at `pos` is nearest: 0 is before the first cell, `n`
 * after the last. `start` is where the first cell begins. */
export function dropSlot(pos: number, start: number, cell: number, n: number): number {
  return Math.max(0, Math.min(n, Math.round((pos - start) / cell)))
}

/** `list` with the item at `from` moved into gap `slot` (0..length). */
export function moveToSlot<T>(list: readonly T[], from: number, slot: number): T[] {
  const rest = list.filter((_, i) => i !== from)
  const at = slot > from ? slot - 1 : slot
  return [...rest.slice(0, at), list[from], ...rest.slice(at)]
}

export function colKey(c: { label: string; key?: string }): string {
  return c.key ?? c.label
}

/** Row names sorted by column `j`, largest value first; when the rows are
 * already in that order, smallest first, so a second click flips it. Ties
 * keep their current order. */
export function sortRowsByColumn(data: EnrichmentHeatmapData, j: number): string[] {
  const idx = data.rows.map((_, i) => i)
  const desc = [...idx].sort((a, b) => data.values[b][j] - data.values[a][j])
  const already = desc.every((v, k) => v === k)
  const order = already ? [...idx].sort((a, b) => data.values[a][j] - data.values[b][j]) : desc
  return order.map((i) => data.rows[i].name)
}

function firstListed(keys: string[], listed: readonly string[] | null): number[] {
  const all = keys.map((_, i) => i)
  if (!listed) return all
  const pos = new Map(keys.map((k, i) => [k, i]))
  const first = [...new Set(listed)].filter((k) => pos.has(k)).map((k) => pos.get(k) as number)
  const taken = new Set(first)
  return [...first, ...all.filter((i) => !taken.has(i))]
}

/** `data` with its rows and/or columns in the given order (null: unchanged);
 * names it lacks are skipped and its other rows follow in their order. */
export function permuteHeatmap(data: EnrichmentHeatmapData, rowNames: readonly string[] | null,
  colKeys: readonly string[] | null): EnrichmentHeatmapData {
  const ri = firstListed(data.rows.map((r) => r.name), rowNames)
  const ci = firstListed(data.cols.map(colKey), colKeys)
  return {
    ...data,
    rows: ri.map((i) => data.rows[i]),
    cols: ci.map((j) => data.cols[j]),
    values: ri.map((i) => ci.map((j) => data.values[i][j])),
    padj: ri.map((i) => ci.map((j) => data.padj[i][j])),
  }
}
