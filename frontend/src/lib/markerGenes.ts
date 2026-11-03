import { restrictionWire, type MarkerRestriction, type MarkerRestrictionWire } from './markerSelection'
/**
 * The one-vs-rest marker-genes request, built from the modal's state.
 *
 * Kept outside the component so the request shape is pinned by a test — in
 * particular that `gene_subset` travels only when a column is chosen. The
 * modal defaults the choice to `highly_variable` when the dataset has that
 * column and to "all genes" otherwise; sending a stale column name to a
 * dataset without it is a 400 the user cannot get past.
 */

export interface MarkerGenesInputs {
  obsColumn: string
  selectedGroups: ReadonlySet<string>
  nCategories: number
  topN: number
  geneSubset: string
  minInGroupFraction: string
  maxOutGroupFraction: string
  minFoldChange: string
  /** The cell mask's cells; null/absent when no mask is active. */
  activeCellIndices?: number[] | null
  /** Show only: applied to the run's own result so the lists match a later select. */
  restrictTo?: MarkerRestriction | null
}

export interface MarkerGenesParams {
  obs_column: string
  groups?: string[]
  top_n: number
  min_in_group_fraction?: number
  max_out_group_fraction?: number
  min_fold_change?: number
  gene_subset?: string
  active_cell_indices?: number[]
  restrict_to?: MarkerRestrictionWire
}

export function markerGenesParams(i: MarkerGenesInputs): MarkerGenesParams {
  const params: MarkerGenesParams = { obs_column: i.obsColumn, top_n: i.topN }
  if (i.geneSubset) params.gene_subset = i.geneSubset
  // "The rest" in one-vs-rest is the rest of the masked cells.
  if (i.activeCellIndices) params.active_cell_indices = i.activeCellIndices
  // Only name the groups when not every category is checked.
  if (i.selectedGroups.size < i.nCategories) params.groups = Array.from(i.selectedGroups)
  const minIGF = parseFloat(i.minInGroupFraction)
  if (!Number.isNaN(minIGF)) params.min_in_group_fraction = minIGF
  const maxOGF = parseFloat(i.maxOutGroupFraction)
  if (!Number.isNaN(maxOGF)) params.max_out_group_fraction = maxOGF
  const minFC = parseFloat(i.minFoldChange)
  if (!Number.isNaN(minFC)) params.min_fold_change = minFC
  if (i.restrictTo) params.restrict_to = restrictionWire(i.restrictTo)
  return params
}

/**
 * Cells per category among the masked cells, from an `/api/obs/{column}`
 * payload: a categorical column arrives as codes (-1 = missing) plus the
 * category names, anything else as raw values. A category with no masked cell
 * is absent, which is how the modal knows the run will leave it out.
 */
export function maskedCategoryCounts(
  col: { values: readonly (number | string | null)[]; categories?: readonly string[] },
  mask: readonly boolean[],
): Map<string, number> {
  const counts = new Map<string, number>()
  const n = Math.min(col.values.length, mask.length)
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue
    const v = col.values[i]
    let key: string | null
    if (col.categories) key = typeof v === 'number' && v >= 0 ? col.categories[v] ?? null : null
    else key = v === null ? null : String(v)
    if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** Checked groups the run will actually test. Under a mask a group needs two
 *  active cells — scanpy cannot test a single-cell group, and the backend
 *  reports it with no markers rather than failing. */
export function runnableGroupCount(selected: ReadonlySet<string>, maskedCounts: ReadonlyMap<string, number> | null): number {
  if (!maskedCounts) return selected.size
  let n = 0
  for (const g of selected) if ((maskedCounts.get(g) ?? 0) >= 2) n++
  return n
}

/** The modal's Top N and thresholds as a selection on the stored ranking
 *  (`POST /api/marker_genes/runs/{key}/select`). The fold-change box is a
 *  ratio, the stored column is log2, so it travels as log2. Blanks and
 *  non-positive fold changes are left out. */
export function selectionFromModal(
  topN: number, minInGroupFraction: string, maxOutGroupFraction: string, minFoldChange: string,
  restrictTo: MarkerRestriction | null = null,
): { top_n: number; min_pct_in?: number; max_pct_out?: number; min_log2fc?: number; restrict_to?: MarkerRestrictionWire } {
  const out: ReturnType<typeof selectionFromModal> = { top_n: Math.max(1, topN) }
  if (restrictTo) out.restrict_to = restrictionWire(restrictTo)
  const minIGF = parseFloat(minInGroupFraction)
  if (Number.isFinite(minIGF)) out.min_pct_in = minIGF
  const maxOGF = parseFloat(maxOutGroupFraction)
  if (Number.isFinite(maxOGF)) out.max_pct_out = maxOGF
  const minFC = parseFloat(minFoldChange)
  if (Number.isFinite(minFC) && minFC > 0) out.min_log2fc = Math.log2(minFC)
  return out
}

// Masks are replaced, not mutated, so identity is the mask's identity.
const maskIds = new WeakMap<readonly boolean[], number>()
let nextMaskId = 1

/** What decides whether the test must run again: the column, the groups,
 *  the gene subset and the cell mask. Top N and the thresholds are not part
 *  of it — they select from the stored ranking. */
export function runSignature(i: Pick<MarkerGenesInputs, 'obsColumn' | 'selectedGroups' | 'geneSubset'> & Record<string, unknown>, mask: readonly boolean[] | null): string {
  let maskId = 0
  if (mask) {
    maskId = maskIds.get(mask) ?? 0
    if (!maskId) { maskId = nextMaskId++; maskIds.set(mask, maskId) }
  }
  return JSON.stringify([i.obsColumn, Array.from(i.selectedGroups).sort(), i.geneSubset, maskId])
}
