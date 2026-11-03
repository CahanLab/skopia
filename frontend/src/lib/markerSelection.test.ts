import { describe, it, expect } from 'vitest'
import {
  markerRequest, markerParams, markerSummary, normalizeHeatmapConfig, rowsFromConfig, DEFAULT_DOTPLOT_OPTIONS,
  type MarkerSource,
} from './markerSelection'
import { dotplotFigureFromConfig, heatmapFigureFromConfig } from './figures'
import type { HeatmapConfig } from '../store'

const src: MarkerSource = {
  key: 'markers_leiden', label: 'leiden', topN: 10,
  minPctIn: 0.25, maxPctOut: null, minLog2fc: 1, maxPadj: null, rankBy: 'score',
}

const sets = [{ id: 'x', name: 'immune', genes: ['Ptprc', 'Cd3e'] }]

const legacy = {
  selectedGeneSets: sets, cellOrdering: 'category', obsColumn: 'leiden', lineName: null,
  geneOrdering: 'as_provided', aggregateGeneSets: false, nBins: 50,
} as unknown as HeatmapConfig

describe('markerRequest / markerParams', () => {
  it('sends the key and the set thresholds, omitting blank ones', () => {
    expect(markerRequest(src)).toEqual({ key: 'markers_leiden', top_n: 10, min_pct_in: 0.25, min_log2fc: 1, rank_by: 'score' })
  })
  it('spells the figure params with nulls for blank thresholds', () => {
    expect(markerParams(src)).toEqual({
      marker_top_n: 10, marker_min_pct_in: 0.25, marker_max_pct_out: null, marker_min_log2fc: 1,
      marker_max_padj: null, marker_rank_by: 'score',
    })
  })
})

describe('markerSummary', () => {
  it('names the run, the N and each active filter', () => {
    expect(markerSummary(src)).toBe('top 10 of markers_leiden · pct in ≥ 0.25 · log2FC ≥ 1')
    expect(markerSummary({ ...src, minPctIn: null, minLog2fc: null, rankBy: 'log2fc' })).toBe('top 10 of markers_leiden · by log2FC')
  })
})

describe('normalizeHeatmapConfig', () => {
  it('reads a config saved before plot types and marker sources as a gene-set heatmap', () => {
    const cfg = normalizeHeatmapConfig(legacy)
    expect(cfg.plotType).toBe('heatmap')
    expect(cfg.markerSource).toBeNull()
    expect(cfg.dotplot).toEqual(DEFAULT_DOTPLOT_OPTIONS)
    expect(cfg.selectedGeneSets).toBe(sets)
  })
  it('keeps what a new config already says', () => {
    const cfg = normalizeHeatmapConfig({ ...legacy, plotType: 'dotplot', markerSource: src, dotplot: { ...DEFAULT_DOTPLOT_OPTIONS, swapAxes: true } })
    expect(cfg.plotType).toBe('dotplot')
    expect(cfg.markerSource).toBe(src)
    expect(cfg.dotplot.swapAxes).toBe(true)
  })
})

describe('rowsFromConfig', () => {
  it('dedupes genes across sets and carries the marker request', () => {
    const rows = rowsFromConfig({ ...legacy, markerSource: src, selectedGeneSets: [...sets, { name: 'b', genes: ['Cd3e', 'Cd19'] }] })
    expect(rows.genes).toEqual(['Ptprc', 'Cd3e', 'Cd19'])
    expect(rows.gene_set_groups).toEqual([{ name: 'immune', genes: ['Ptprc', 'Cd3e'] }, { name: 'b', genes: ['Cd3e', 'Cd19'] }])
    expect(rows.markers).toEqual(markerRequest(src))
  })
  it('sends no markers field without a source', () => {
    expect(rowsFromConfig(legacy).markers).toBeNull()
  })
})

describe('figure builders', () => {
  it('a heatmap from markers carries the key as an input and the selection as params', () => {
    const fig = heatmapFigureFromConfig({ ...legacy, markerSource: src, selectedGeneSets: [] }, null, 'log1p')
    expect(fig.inputs.marker_key).toBe('markers_leiden')
    expect(fig.inputs.gene_sets).toEqual([])
    expect(fig.params.marker_top_n).toBe(10)
    expect(fig.params.n_bins).toBe(50)
  })
  it('a heatmap without markers has no marker params', () => {
    const fig = heatmapFigureFromConfig(legacy, null)
    expect(fig.inputs.marker_key).toBeNull()
    expect('marker_top_n' in fig.params).toBe(false)
  })
  it('a dot plot figure names its kind, column and options', () => {
    const fig = dotplotFigureFromConfig({ ...legacy, plotType: 'dotplot', markerSource: src, dotplot: { ...DEFAULT_DOTPLOT_OPTIONS, colorBy: 'mean_expressing', vmax: 2 } }, 'half', null)
    expect(fig.kind).toBe('expression_dotplot')
    expect(fig.inputs).toEqual({ gene_sets: [{ name: 'immune', genes: ['Ptprc', 'Cd3e'] }], marker_key: 'markers_leiden', obs_column: 'leiden', transform: null, cell_subset: 'half', cell_indices: null })
    expect(fig.params).toEqual({
      ...markerParams(src), color_by: 'mean_expressing', standard_scale: 'none', expression_cutoff: 0, gene_ordering: 'as_provided',
      swap_axes: false, colormap: 'viridis', vmax: 2, dot_max: null,
    })
  })
})
