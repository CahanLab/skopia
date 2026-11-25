import { describe, it, expect } from 'vitest'
import { hvgPreviewBody, linearTicks, log10Ticks, hvgPreviewSummary, hvgErrorMessage } from './hvgPreview'

describe('hvgPreviewBody', () => {
  it('sends the settings the run would use', () => {
    expect(hvgPreviewBody({ n_top_genes: 2000, min_mean: 0.0125, max_mean: 6, min_disp: 0.5, flavor: 'cell_ranger', split_by: '' }, null))
      .toEqual({ n_top_genes: 2000, min_mean: 0.0125, max_mean: 6, min_disp: 0.5, flavor: 'cell_ranger' })
  })

  it('an emptied field is left out so the backend default applies, and an empty top N means thresholds', () => {
    expect(hvgPreviewBody({ n_top_genes: null, min_mean: null, max_mean: 3, min_disp: 0.5, flavor: 'seurat' }, null))
      .toEqual({ n_top_genes: null, max_mean: 3, min_disp: 0.5, flavor: 'seurat' })
  })

  it('carries the active cells, as the run does', () => {
    expect(hvgPreviewBody({ n_top_genes: 100, flavor: 'seurat' }, [0, 2, 5])).toEqual({
      n_top_genes: 100, flavor: 'seurat', active_cell_indices: [0, 2, 5],
    })
  })

  it('carries the gene subset, as the run does', () => {
    expect(hvgPreviewBody({ n_top_genes: 100, flavor: 'seurat' }, null, 'analysis_genes')).toEqual({
      n_top_genes: 100, flavor: 'seurat', gene_subset: 'analysis_genes',
    })
    const both = { columns: ['analysis_genes', 'expressed'], operation: 'intersection' as const }
    expect(hvgPreviewBody({ n_top_genes: 100, flavor: 'seurat' }, null, both)).toEqual({
      n_top_genes: 100, flavor: 'seurat', gene_subset: both,
    })
  })

  it('sends no gene subset when none is picked, meaning every gene', () => {
    expect(hvgPreviewBody({ n_top_genes: 100, flavor: 'seurat' }, null, null)).toEqual({
      n_top_genes: 100, flavor: 'seurat',
    })
  })

  it('has no preview for a split run, which detects within each group', () => {
    expect(hvgPreviewBody({ n_top_genes: 100, flavor: 'seurat', split_by: 'sample' }, null)).toBeNull()
  })

  it('has no preview while a number field holds something that is not a number', () => {
    expect(hvgPreviewBody({ n_top_genes: 'abc', flavor: 'seurat' }, null)).toBeNull()
  })
})

describe('linearTicks', () => {
  it('gives round steps spanning the range', () => {
    expect(linearTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
    expect(linearTicks(-1.3, 4.2, 5)).toEqual([-1, 0, 1, 2, 3, 4])
    expect(linearTicks(0.01, 0.049, 4)).toEqual([0.01, 0.02, 0.03, 0.04])
  })

  it('a zero-width range still gets one tick', () => {
    expect(linearTicks(3, 3, 5)).toEqual([3])
  })
})

describe('log10Ticks', () => {
  it('gives the powers of ten inside the range', () => {
    expect(log10Ticks(0.003, 250)).toEqual([0.01, 0.1, 1, 10, 100])
  })
})

describe('hvgPreviewSummary', () => {
  it('says how many genes the settings select and how many are drawn', () => {
    expect(hvgPreviewSummary({ n_highly_variable: 2000, n_genes: 17321, n_plotted: 16900, n_cells: 65287 }))
      .toBe('2,000 of 17,321 genes selected · 16,900 drawn (the rest have no dispersion) · 65,287 cells')
    expect(hvgPreviewSummary({ n_highly_variable: 12, n_genes: 40, n_plotted: 40, n_cells: 80 }))
      .toBe('12 of 40 genes selected · 80 cells')
  })
})

describe('hvgErrorMessage', () => {
  it('explains scanpy\'s bin-edge failure instead of dumping the bin index', () => {
    const raw = 'Bin edges must be unique: Index([ -inf, 1e-12, 1e-12, 0.001 ...], dtype=float64)'
    const msg = hvgErrorMessage(raw, 'cell_ranger')
    expect(msg).toMatch(/Filter Genes/)
    expect(msg).toMatch(/cell_ranger/)
    expect(msg).not.toMatch(/Index\(/)
  })
  it('passes any other message through', () => {
    expect(hvgErrorMessage('flavor must be one of …', 'seurat')).toBe('flavor must be one of …')
  })
})
