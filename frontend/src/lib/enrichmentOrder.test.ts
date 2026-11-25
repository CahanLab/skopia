import { describe, expect, it } from 'vitest'
import { dropSlot, moveToSlot, permuteHeatmap, sortRowsByColumn } from './enrichmentOrder'
import type { EnrichmentHeatmapData } from './figures'

const data: EnrichmentHeatmapData = {
  rows: ['S1', 'S2', 'S3'].map((name) => ({ name, library: 'L', members: [], n_set: 5 })),
  cols: [{ label: 'A', key: 'a' }, { label: 'B', key: 'b' }],
  values: [[1, -2], [3, 0.5], [-1, 2]],
  padj: [[0.1, 0.2], [0.3, 0.4], [0.5, 0.6]],
  value_label: 'NES', n_rows_total: 3, n_collapsed: 0, note: null,
}

describe('moveToSlot', () => {
  it('moves an item to the gap before slot (0..n)', () => {
    expect(moveToSlot(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveToSlot(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveToSlot(['a', 'b', 'c', 'd'], 1, 4)).toEqual(['a', 'c', 'd', 'b'])
    expect(moveToSlot(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
    expect(moveToSlot(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'b', 'c'])
  })
})

describe('dropSlot', () => {
  it('is the nearest gap between cells, clamped to the ends', () => {
    expect(dropSlot(100, 100, 10, 4)).toBe(0)
    expect(dropSlot(114, 100, 10, 4)).toBe(1)
    expect(dropSlot(116, 100, 10, 4)).toBe(2)
    expect(dropSlot(500, 100, 10, 4)).toBe(4)
    expect(dropSlot(-50, 100, 10, 4)).toBe(0)
  })
})

describe('sortRowsByColumn', () => {
  it('sorts the rows by one column, largest first, then smallest first when already so', () => {
    expect(sortRowsByColumn(data, 0)).toEqual(['S2', 'S1', 'S3'])
    const desc = permuteHeatmap(data, ['S2', 'S1', 'S3'], null)
    expect(sortRowsByColumn(desc, 0)).toEqual(['S3', 'S1', 'S2'])
  })
  it('keeps the current order among ties', () => {
    const tied = { ...data, values: [[1, 0], [1, 0], [2, 0]] }
    expect(sortRowsByColumn(tied, 0)).toEqual(['S3', 'S1', 'S2'])
  })
})

describe('permuteHeatmap', () => {
  it('reorders rows and columns with their values and padj', () => {
    const p = permuteHeatmap(data, ['S3', 'S1', 'S2'], ['b', 'a'])
    expect(p.rows.map((r) => r.name)).toEqual(['S3', 'S1', 'S2'])
    expect(p.cols.map((c) => c.key)).toEqual(['b', 'a'])
    expect(p.values).toEqual([[2, -1], [-2, 1], [0.5, 3]])
    expect(p.padj[0]).toEqual([0.6, 0.5])
  })
  it('null leaves an axis alone; unknown names are skipped and missing ones follow', () => {
    const p = permuteHeatmap(data, ['S2', 'gone'], null)
    expect(p.rows.map((r) => r.name)).toEqual(['S2', 'S1', 'S3'])
    expect(p.cols).toEqual(data.cols)
  })
})
