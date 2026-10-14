/**
 * A percentage of the dataset, as the whole number of cells scanpy is given.
 *
 * Floored at 1: a threshold that rounds to zero would keep every gene, which is
 * not what asking for a threshold means. An empty box is 0 — the parameter is
 * optional and omitting it is a real choice.
 */
export function percentOfCells(value: unknown, nCells: number): number {
  const pct = Number(value)
  if (!Number.isFinite(pct) || pct <= 0) return 0
  return Math.max(1, Math.round((pct / 100) * nCells))
}

/** The inverse, for a histogram cutoff dragged in cells: the percentage whose
 * `percentOfCells` is this count (three places, so one cell in 100,000 is
 * still representable). */
export function percentFromCells(count: number, nCells: number): number {
  if (!(nCells > 0) || !(count > 0)) return 0
  return Math.round((count / nCells) * 100 * 1000) / 1000
}
