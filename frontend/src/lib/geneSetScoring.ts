/** How a gene set becomes one per-cell score: the Display panel's options
 *  for colouring the embedding by a set, shared with the Expression tab's
 *  aggregate rows so the two offer the same choices, labels and defaults.
 *  The backend lists are `heatmap.GENE_SET_*`. */

import type { DisplayPreferences, GeneSetAggregation, GeneSetPerGeneNorm } from '../store'

export type GeneSetScoringMethod = 'mean' | 'ucell'

export interface GeneSetScoring {
  scoringMethod: GeneSetScoringMethod
  perGeneNorm: GeneSetPerGeneNorm
  /** minmax only: percentile clipped at each end before the rescale. */
  perGeneClip: number
  aggregation: GeneSetAggregation
}

interface Option<T extends string> { value: T; label: string; hint: string }

export const SCORING_METHOD_OPTIONS: Option<GeneSetScoringMethod>[] = [
  { value: 'mean', label: 'Mean / per-gene norm', hint: 'Per-gene normalize then aggregate across genes (settings below).' },
  { value: 'ucell', label: 'UCell (rank AUC, directional)', hint: 'Per-cell rank-based AUC; uses a set’s down-genes when present. Source layer is counts.' },
]

export const PER_GENE_NORM_OPTIONS: Option<GeneSetPerGeneNorm>[] = [
  // "None" reads the same source as every other option (.X, or its log1p,
  // or the chosen layer); it only skips the per-gene rescale. The old label
  // "raw values" read as raw counts.
  { value: 'none', label: 'None (no per-gene scaling)', hint: 'Each gene’s values as the source holds them, so high-magnitude genes dominate.' },
  { value: 'zscore_mad', label: 'Z-score (MAD, robust)', hint: 'Center on the median, scale by MAD; falls back to SD if MAD is 0.' },
  { value: 'zscore_sd', label: 'Z-score (SD)', hint: 'Center on the mean, scale by standard deviation.' },
  { value: 'minmax', label: 'Min-max [0, 1]', hint: 'Clip per gene then rescale to [0, 1] — every gene votes equally regardless of scale.' },
  { value: 'rank', label: 'Rank → [0, 1]', hint: 'Replace each cell’s value with its average rank within the gene, then divide by N.' },
]

export const AGGREGATION_OPTIONS: Option<GeneSetAggregation>[] = [
  { value: 'mean', label: 'Mean', hint: 'Average of per-gene values per cell.' },
  { value: 'median', label: 'Median', hint: 'Middle value per cell — robust to one or two outlier genes.' },
  { value: 'sum', label: 'Sum', hint: 'Total per cell — emphasizes broad expression.' },
  { value: 'max', label: 'Max', hint: 'Brightest gene per cell — emphasizes any-of-set expression.' },
]

export function optionHint<T extends string>(options: Option<T>[], value: T): string {
  return options.find((o) => o.value === value)?.hint ?? ''
}

/** The Display panel's shipped defaults (`defaultDisplayPreferences`, and
 *  config.yaml `display:` / `figures.expression_heatmap`). */
export const DEFAULT_GENE_SET_SCORING: GeneSetScoring = {
  scoringMethod: 'mean', perGeneNorm: 'zscore_mad', perGeneClip: 1.0, aggregation: 'mean',
}

/** What Display is set to now: where a new Expression config starts. */
export function scoringFromDisplay(dp: Pick<DisplayPreferences, 'geneSetScoringMethod' | 'geneSetPerGeneNorm' | 'geneSetPerGeneClip' | 'geneSetAggregation'>): GeneSetScoring {
  return {
    scoringMethod: dp.geneSetScoringMethod, perGeneNorm: dp.geneSetPerGeneNorm,
    perGeneClip: dp.geneSetPerGeneClip, aggregation: dp.geneSetAggregation,
  }
}

/** The heatmap request fields and figure params (the backend's names). */
export function scoringParams(s: GeneSetScoring) {
  return {
    gene_set_scoring_method: s.scoringMethod, gene_set_per_gene_norm: s.perGeneNorm,
    gene_set_per_gene_clip: s.perGeneClip, gene_set_aggregation: s.aggregation,
  }
}

const NORM_SHORT: Record<GeneSetPerGeneNorm, string> = {
  none: 'no per-gene scaling', zscore_mad: 'z-score (MAD)', zscore_sd: 'z-score (SD)', minmax: 'min-max', rank: 'rank',
}

/** One phrase for the toolbar: `z-score (MAD), mean`, `UCell`. */
export function scoringSummary(s: GeneSetScoring): string {
  if (s.scoringMethod === 'ucell') return 'UCell'
  const norm = s.perGeneNorm === 'minmax' ? `min-max (clip ${s.perGeneClip}%)` : NORM_SHORT[s.perGeneNorm]
  return `${norm}, ${s.aggregation}`
}
