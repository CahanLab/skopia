/** A stored marker run as the row source of an expression plot, and the
 *  selection on it (top N after filters). Pure helpers so the request and
 *  figure shapes are pinned by a test; the Heatmap tab, the marker modal and
 *  the figure builders all go through here. */

import type { HeatmapConfig } from '../store'

/** Keep only marker genes in an annotation: a Gene Panel set (snapshot of
 *  its genes) or a boolean `.var` column. The label is what the picker showed. */
export type MarkerRestriction = { label: string; genes: string[] } | { label: string; varColumn: string }
export type MarkerRestrictionWire = { label: string; genes: string[] } | { label: string; var_column: string }

export function restrictionWire(r: MarkerRestriction): MarkerRestrictionWire {
  return 'genes' in r ? { label: r.label, genes: r.genes } : { label: r.label, var_column: r.varColumn }
}

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
  restrictTo: MarkerRestriction | null
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
  return { key, label, topN, minPctIn: null, maxPctOut: null, minLog2fc: null, maxPadj: null, rankBy: 'score', restrictTo: null }
}

export interface MarkerRequest {
  key: string
  top_n: number
  min_pct_in?: number
  max_pct_out?: number
  min_log2fc?: number
  max_padj?: number
  rank_by: 'score' | 'log2fc'
  restrict_to?: MarkerRestrictionWire
}

/** The `markers` field of a heatmap / dot plot request: blank thresholds are left out. */
export function markerRequest(src: MarkerSource): MarkerRequest {
  const out: MarkerRequest = { key: src.key, top_n: src.topN, rank_by: src.rankBy }
  if (src.minPctIn !== null) out.min_pct_in = src.minPctIn
  if (src.maxPctOut !== null) out.max_pct_out = src.maxPctOut
  if (src.minLog2fc !== null) out.min_log2fc = src.minLog2fc
  if (src.maxPadj !== null) out.max_padj = src.maxPadj
  if (src.restrictTo) out.restrict_to = restrictionWire(src.restrictTo)
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
  if (src.restrictTo) parts.push(`in ${src.restrictTo.label}`)
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
    markerSource: cfg.markerSource ? { ...cfg.markerSource, restrictTo: cfg.markerSource.restrictTo ?? null } : null,
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

export interface RestrictionOption {
  value: string
  label: string
  group: 'Gene sets' | '.var columns'
  restriction: MarkerRestriction
}

/** The picker's options: Gene Panel sets with genes (up and down together,
 *  deduplicated), then the boolean `.var` columns. */
export function restrictionOptions(
  sets: { id: string; name: string; genes: string[]; genesDown?: string[] }[],
  columns: { name: string; n_true: number }[],
): RestrictionOption[] {
  const out: RestrictionOption[] = []
  for (const gs of sets) {
    const genes = Array.from(new Set([...gs.genes, ...(gs.genesDown ?? [])]))
    if (!genes.length) continue
    out.push({ value: `set:${gs.id}`, label: `${gs.name} (${genes.length})`, group: 'Gene sets', restriction: { label: gs.name, genes } })
  }
  for (const c of columns) {
    out.push({ value: `col:${c.name}`, label: `${c.name} (${c.n_true.toLocaleString()})`, group: '.var columns', restriction: { label: c.name, varColumn: c.name } })
  }
  return out
}

/** The option a stored restriction (a snapshot) corresponds to, by label and
 *  source kind; `'saved'` when none does (set renamed or deleted, column gone),
 *  `''` for no restriction. */
export function matchRestriction(options: RestrictionOption[], snapshot: MarkerRestriction | null): string {
  if (!snapshot) return ''
  const kind = 'genes' in snapshot ? 'Gene sets' : '.var columns'
  return options.find((o) => o.group === kind && o.restriction.label === snapshot.label)?.value ?? 'saved'
}

/** Does the config name any rows at all? */
export function hasRows(cfg: HeatmapConfig): boolean {
  return Boolean(cfg.markerSource) || (cfg.selectedGeneSets ?? []).length > 0
}
