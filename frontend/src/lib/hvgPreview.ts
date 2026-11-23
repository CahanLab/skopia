/** The Highly Variable Genes preview: request body, axes, summary line. */

/** What POST /api/scanpy/highly_variable_genes/preview returns. */
export interface HvgPreview {
  flavor: string
  x_label: string
  x_log: boolean
  y_label: string
  genes: string[]
  x: number[]
  y: number[]
  highly_variable: boolean[]
  /** Infinite normalized dispersion (a bin with zero MAD), drawn at the edge. */
  off_scale: boolean[]
  n_highly_variable: number
  n_genes: number
  n_plotted: number
  n_cells: number
  /** The cutoffs, when they act: no top-N asked for, and not seurat_v3. */
  thresholds: { min_mean: number; max_mean: number; min_disp: number } | null
}

const NUMBER_KEYS = ['min_mean', 'max_mean', 'min_disp'] as const

/**
 * The preview request for the modal's current HVG settings, or null when
 * there is nothing honest to preview: a split run detects within each group,
 * and a field holding text that is not a number would 422.
 *
 * n_top_genes is always sent, null included, because an empty top N is a
 * setting (select by thresholds), not a missing one.
 */
export function hvgPreviewBody(
  params: Record<string, unknown>,
  activeIndices: number[] | null,
): Record<string, unknown> | null {
  if (typeof params.split_by === 'string' && params.split_by !== '') return null
  const top = params.n_top_genes
  if (top != null && top !== '' && typeof top !== 'number') return null
  const body: Record<string, unknown> = { n_top_genes: top === '' || top == null ? null : top }
  for (const k of NUMBER_KEYS) {
    const v = params[k]
    if (v == null || v === '') continue
    if (typeof v !== 'number') return null
    body[k] = v
  }
  if (typeof params.flavor === 'string' && params.flavor) body.flavor = params.flavor
  if (activeIndices) body.active_cell_indices = activeIndices
  return body
}

/** Round-numbered ticks covering [min, max], about `count` of them. */
export function linearTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min]
  // d3's rule: the 1-2-5 step nearest the raw step (geometrically).
  const raw = (max - min) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const err = raw / mag
  const step = mag * (err >= Math.sqrt(50) ? 10 : err >= Math.sqrt(10) ? 5 : err >= Math.sqrt(2) ? 2 : 1)
  const first = Math.ceil(min / step - 1e-9) * step
  const out: number[] = []
  for (let v = first; v <= max + step * 1e-9; v += step) {
    // Snap away float drift (0.30000000000000004) at the step's precision.
    const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1)
    out.push(Number(v.toFixed(digits)))
  }
  return out
}

/** Powers of ten inside [min, max] (min > 0). */
export function log10Ticks(min: number, max: number): number[] {
  const out: number[] = []
  for (let e = Math.ceil(Math.log10(min)); e <= Math.floor(Math.log10(max)); e++) {
    out.push(Number((10 ** e).toPrecision(1)))
  }
  return out
}

export function hvgPreviewSummary(p: Pick<HvgPreview, 'n_highly_variable' | 'n_genes' | 'n_plotted' | 'n_cells'>): string {
  const n = (v: number) => v.toLocaleString('en-US')
  const parts = [`${n(p.n_highly_variable)} of ${n(p.n_genes)} genes selected`]
  if (p.n_plotted < p.n_genes) parts.push(`${n(p.n_plotted)} drawn (the rest have no dispersion)`)
  parts.push(`${n(p.n_cells)} cells`)
  return parts.join(' · ')
}

/** scanpy's failure when too many genes share a mean (pandas prints the whole
 * bin index), said in terms of what to do. The run fails the same way. */
export function hvgErrorMessage(raw: string, flavor: string): string {
  if (/Bin edges must be unique/.test(raw)) {
    return `The ${flavor} method could not bin the genes by mean expression: too many genes share the same mean, ` +
      'usually genes with no counts in these cells. Run Filter Genes first, or choose the seurat method.'
  }
  return raw
}
