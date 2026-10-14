/** Pure pieces of the Filter Cells / Filter Genes histograms: the log-axis
 * mapping between threshold values and chart coordinates, the live pass
 * count that must mirror the backend's mask exactly (inclusive bounds, AND
 * of all set bounds, a null metric fails any bound on it), and the
 * median ± k·MAD rule that places both cutoffs at once. */

export function toChartSpace(value: number, log: boolean): number {
  return log ? Math.log10(1 + value) : value
}

/** Back to data units, rounded to `decimals` (counts are whole numbers; a
 * percentage keeps two places). */
export function fromChartSpace(chartValue: number, log: boolean, decimals = 0): number {
  const raw = log ? Math.pow(10, chartValue) - 1 : chartValue
  const f = Math.pow(10, decimals)
  return Math.round(raw * f) / f
}

/** Compact count for axis labels: 950, 1.2k, 48k. */
export function formatCount(v: number): string {
  if (v < 1000) return String(Math.round(v))
  const k = v / 1000
  return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`
}

/** Percentage for axis labels: 0, 2.5, 100. */
export function formatPercent(v: number): string {
  return `${Math.round(v * 10) / 10}%`
}

export interface FilterBounds {
  minCounts?: number | null
  maxCounts?: number | null
  minGenes?: number | null
  maxGenes?: number | null
  minPctMt?: number | null
  maxPctMt?: number | null
}

export function passingCount(
  counts: Array<number | null>,
  genes: Array<number | null>,
  bounds: FilterBounds,
  pctMt: Array<number | null> | null = null,
): number {
  const { minCounts, maxCounts, minGenes, maxGenes, minPctMt, maxPctMt } = bounds
  let n = 0
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i]
    const g = genes[i]
    const m = pctMt ? pctMt[i] : null
    if (minCounts != null && !(c != null && c >= minCounts)) continue
    if (maxCounts != null && !(c != null && c <= maxCounts)) continue
    if (minGenes != null && !(g != null && g >= minGenes)) continue
    if (maxGenes != null && !(g != null && g <= maxGenes)) continue
    if (minPctMt != null && !(m != null && m >= minPctMt)) continue
    if (maxPctMt != null && !(m != null && m <= maxPctMt)) continue
    n++
  }
  return n
}

export function median(sorted: number[]): number {
  const n = sorted.length
  if (n === 0) return NaN
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}

/** Median absolute deviation, unscaled — the convention of
 * scipy.stats.median_abs_deviation and the sc-best-practices QC chapter
 * (a 5-MAD cutoff there is 5 of these, not 5 × 1.4826). */
export function mad(values: number[], med = median([...values].sort((a, b) => a - b))): number {
  const dev = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
  return median(dev)
}

/** Both cutoffs at median ± k·MAD, measured on the axis as drawn (log₁₀(1+x)
 * when `log`, where a count distribution is close to symmetric) and returned
 * in data units. A cutoff at or beyond the data's own extent is null: it
 * would exclude nothing, and the panel shows "no threshold" for it. */
export function madBounds(
  values: Array<number | null>,
  k: number,
  log: boolean,
  decimals = 0,
): { lo: number | null; hi: number | null } {
  const xs: number[] = []
  for (const v of values) if (v != null && Number.isFinite(v)) xs.push(toChartSpace(v, log))
  if (xs.length === 0 || !(k > 0)) return { lo: null, hi: null }
  xs.sort((a, b) => a - b)
  const med = median(xs)
  const m = mad(xs, med)
  const minC = xs[0], maxC = xs[xs.length - 1]
  const loC = med - k * m, hiC = med + k * m
  return {
    lo: loC <= minC ? null : fromChartSpace(loC, log, decimals),
    hi: hiC >= maxC ? null : fromChartSpace(hiC, log, decimals),
  }
}
