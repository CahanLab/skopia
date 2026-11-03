/** A stored marker run as the row source of an expression plot, and the
 *  selection on it (top N after filters). Pure helpers so the request and
 *  figure shapes are pinned by a test; the Heatmap tab, the marker modal and
 *  the figure builders all go through here. */

import type { HeatmapConfig } from '../store'

export interface MarkerSource {
  /** Key of the run in `uns['xcell_marker_genes']`. */
  key: string
  /** What the picker showed: the run's column (and label when it has one). */
  label: string
  topN: number
  minPctIn: number | null
  maxPctOut: number | null
  minLog2fc: number | null
  maxPadj: number | null
  rankBy: 'score' | 'log2fc'
}

export interface DotplotOptions {
  colorBy: 'mean' | 'mean_expressing'
  standardScale: 'none' | 'gene'
  expressionCutoff: number
  geneOrdering: 'as_provided' | 'peak_group'
  swapAxes: boolean
  colormap: 'viridis' | 'reds' | 'rdbu'
  vmax: number | null
  dotMax: number | null
}

export const DEFAULT_DOTPLOT_OPTIONS: DotplotOptions = {
  colorBy: 'mean', standardScale: 'none', expressionCutoff: 0, geneOrdering: 'as_provided',
  swapAxes: false, colormap: 'viridis', vmax: null, dotMax: null,
}

export function defaultMarkerSource(key: string, label: string, topN = 10): MarkerSource {
  return { key, label, topN, minPctIn: null, maxPctOut: null, minLog2fc: null, maxPadj: null, rankBy: 'score' }
}

export interface MarkerRequest {
  key: string
  top_n: number
  min_pct_in?: number
  max_pct_out?: number
  min_log2fc?: number
  max_padj?: number
  rank_by: 'score' | 'log2fc'
}

/** The `markers` field of a heatmap / dot plot request: blank thresholds are left out. */
export function markerRequest(src: MarkerSource): MarkerRequest {
  const out: MarkerRequest = { key: src.key, top_n: src.topN, rank_by: src.rankBy }
  if (src.minPctIn !== null) out.min_pct_in = src.minPctIn
  if (src.maxPctOut !== null) out.max_pct_out = src.maxPctOut
  if (src.minLog2fc !== null) out.min_log2fc = src.minLog2fc
  if (src.maxPadj !== null) out.max_padj = src.maxPadj
  return out
}

/** The same selection as figure params (the backend's `marker_*` keys). */
export function markerParams(src: MarkerSource): Record<string, unknown> {
  return {
    marker_top_n: src.topN, marker_min_pct_in: src.minPctIn, marker_max_pct_out: src.maxPctOut,
    marker_min_log2fc: src.minLog2fc, marker_max_padj: src.maxPadj, marker_rank_by: src.rankBy,
  }
}

/** One line for a toolbar: `top 10 of markers_leiden · pct in ≥ 0.25 · log2FC ≥ 1`. */
export function markerSummary(src: MarkerSource): string {
  const parts = [`top ${src.topN} of ${src.key}`]
  if (src.minPctIn !== null) parts.push(`pct in ≥ ${src.minPctIn}`)
  if (src.maxPctOut !== null) parts.push(`pct out ≤ ${src.maxPctOut}`)
  if (src.minLog2fc !== null) parts.push(`log2FC ≥ ${src.minLog2fc}`)
  if (src.maxPadj !== null) parts.push(`padj ≤ ${src.maxPadj}`)
  if (src.rankBy === 'log2fc') parts.push('by log2FC')
  return parts.join(' · ')
}

export type NormalizedHeatmapConfig = HeatmapConfig & {
  plotType: 'heatmap' | 'dotplot'
  markerSource: MarkerSource | null
  dotplot: DotplotOptions
}

/** A config saved before plot types and marker sources existed is a gene-set heatmap. */
export function normalizeHeatmapConfig(cfg: HeatmapConfig): NormalizedHeatmapConfig {
  return {
    ...cfg,
    selectedGeneSets: cfg.selectedGeneSets ?? [],
    plotType: cfg.plotType ?? 'heatmap',
    markerSource: cfg.markerSource ?? null,
    dotplot: { ...DEFAULT_DOTPLOT_OPTIONS, ...(cfg.dotplot ?? {}) },
  }
}

/** The rows fragment both `/api/heatmap/data` and `/api/dotplot/data` take. */
export function rowsFromConfig(cfg: HeatmapConfig): { genes: string[]; gene_set_groups: { name: string; genes: string[] }[]; markers: MarkerRequest | null } {
  const sets = cfg.selectedGeneSets ?? []
  const seen = new Set<string>()
  const genes: string[] = []
  for (const gs of sets) for (const g of gs.genes) if (!seen.has(g)) { seen.add(g); genes.push(g) }
  return {
    genes,
    gene_set_groups: sets.map((gs) => ({ name: gs.name, genes: gs.genes })),
    markers: cfg.markerSource ? markerRequest(cfg.markerSource) : null,
  }
}

/** Does the config name any rows at all? */
export function hasRows(cfg: HeatmapConfig): boolean {
  return Boolean(cfg.markerSource) || (cfg.selectedGeneSets ?? []).length > 0
}
