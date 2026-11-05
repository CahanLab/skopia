import { describe, it, expect } from 'vitest'
import {
  clickSelection,
  mergeDefaultName,
  convertTargets,
  countByKind,
  defaultTrueValue,
  filterColumns,
  formatPreview,
  newNameProblem,
  pruneSelection,
  sortColumns,
  toggleAllVisible,
  visibleTickState,
  type ObsColumnInfo,
  type ObsKind,
} from './obsManager'

function col(name: string, kind: ObsKind, extra: Partial<ObsColumnInfo> = {}): ObsColumnInfo {
  return {
    name, kind, dtype: kind, n_unique: 3, n_missing: 0,
    preview: { top: [] }, has_colors: false, subset: null, prefix_group: null, ...extra,
  }
}

const COLS = [
  col('leiden', 'categorical', { n_unique: 12 }),
  col('score', 'float', { n_unique: 900, n_missing: 4 }),
  col('Batch', 'string', { n_unique: 3 }),
  col('is_doublet', 'boolean', { n_unique: 2 }),
  col('weird', 'other', { n_unique: null }),
  col('n_genes', 'integer', { n_unique: 150 }),
]
const names = (cs: ObsColumnInfo[]) => cs.map((c) => c.name)

describe('sortColumns', () => {
  it('keeps .obs order by default and reverses it on desc', () => {
    expect(names(sortColumns(COLS, { key: 'order', dir: 'asc' }))).toEqual(names(COLS))
    expect(names(sortColumns(COLS, { key: 'order', dir: 'desc' }))).toEqual(names(COLS).reverse())
  })

  it('sorts names case-insensitively', () => {
    expect(names(sortColumns(COLS, { key: 'name', dir: 'asc' })))
      .toEqual(['Batch', 'is_doublet', 'leiden', 'n_genes', 'score', 'weird'])
  })

  it('sorts unique counts with unknown counts last in both directions', () => {
    expect(names(sortColumns(COLS, { key: 'n_unique', dir: 'desc' })).slice(-1)).toEqual(['weird'])
    expect(names(sortColumns(COLS, { key: 'n_unique', dir: 'asc' }))).toEqual(
      ['is_doublet', 'Batch', 'leiden', 'n_genes', 'score', 'weird'])
  })

  it('breaks ties by .obs order', () => {
    const s = sortColumns(COLS, { key: 'n_missing', dir: 'asc' })
    expect(names(s)).toEqual(['leiden', 'Batch', 'is_doublet', 'weird', 'n_genes', 'score'])
  })

  it('does not mutate its input', () => {
    const copy = [...COLS]
    sortColumns(COLS, { key: 'name', dir: 'desc' })
    expect(COLS).toEqual(copy)
  })
})

describe('filterColumns', () => {
  it('matches a substring of the name, ignoring case', () => {
    expect(names(filterColumns(COLS, 'GEN', new Set()))).toEqual(['n_genes'])
  })
  it('restricts to the chosen kinds; none chosen means all', () => {
    expect(names(filterColumns(COLS, '', new Set<ObsKind>(['float', 'integer'])))).toEqual(['score', 'n_genes'])
    expect(filterColumns(COLS, '', new Set())).toHaveLength(COLS.length)
  })
  it('counts columns per kind for the chips', () => {
    expect(countByKind(COLS)).toEqual({ categorical: 1, boolean: 1, integer: 1, float: 1, string: 1, other: 1 })
  })
})

describe('clickSelection', () => {
  const visible = ['a', 'b', 'c', 'd', 'e']

  it('toggles one row and makes it the anchor', () => {
    const r = clickSelection(new Set(), 'b', { shift: false, anchor: null, visible })
    expect([...r.selected]).toEqual(['b'])
    expect(r.anchor).toBe('b')
    const r2 = clickSelection(r.selected, 'b', { shift: false, anchor: 'b', visible })
    expect(r2.selected.size).toBe(0)
  })

  it('shift-click selects the range from the anchor, either direction', () => {
    const down = clickSelection(new Set(['b']), 'd', { shift: true, anchor: 'b', visible })
    expect([...down.selected].sort()).toEqual(['b', 'c', 'd'])
    expect(down.anchor).toBe('b')
    const up = clickSelection(new Set(['d']), 'a', { shift: true, anchor: 'd', visible })
    expect([...up.selected].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('shift-click on a selected row clears the range', () => {
    const r = clickSelection(new Set(['a', 'b', 'c', 'd']), 'c', { shift: true, anchor: 'a', visible })
    expect([...r.selected]).toEqual(['d'])
  })

  it('falls back to a plain toggle when the anchor is filtered out', () => {
    const r = clickSelection(new Set(['zz']), 'c', { shift: true, anchor: 'zz', visible })
    expect([...r.selected].sort()).toEqual(['c', 'zz'])
    expect(r.anchor).toBe('c')
  })
})

describe('select all visible', () => {
  it('selects every visible row, then clears them, leaving hidden selections alone', () => {
    const vis = ['a', 'b']
    expect(visibleTickState(new Set(['hidden']), vis)).toBe('none')
    const all = toggleAllVisible(new Set(['hidden']), vis)
    expect([...all].sort()).toEqual(['a', 'b', 'hidden'])
    expect(visibleTickState(all, vis)).toBe('all')
    expect([...toggleAllVisible(all, vis)]).toEqual(['hidden'])
    expect(visibleTickState(new Set(['a']), vis)).toBe('some')
  })

  it('prunes names that no longer exist', () => {
    expect([...pruneSelection(new Set(['a', 'gone']), ['a', 'b'])]).toEqual(['a'])
  })
})

describe('names and conversions', () => {
  it('refuses empty and taken names', () => {
    expect(newNameProblem('  ', ['a'])).toMatch(/Enter/)
    expect(newNameProblem('a', ['a'])).toMatch(/already exists/)
    expect(newNameProblem(' b ', ['a'])).toBeNull()
    expect(newNameProblem('subset_x', ['a'])).toMatch(/saved cell subsets/)
  })

  it('offers boolean only for two-valued complete columns and nothing for a subset column', () => {
    expect(convertTargets(col('x', 'string', { n_unique: 2 }))).toEqual(['categorical', 'numeric', 'boolean'])
    expect(convertTargets(col('x', 'string', { n_unique: 2, n_missing: 1 }))).not.toContain('boolean')
    expect(convertTargets(col('x', 'float'))).toEqual(['categorical', 'string'])
    expect(convertTargets(col('subset_a', 'boolean', { subset: 'a', n_unique: 2 }))).toEqual([])
  })

  it('defaults True to a recognisable word, else the first value', () => {
    expect(defaultTrueValue(['no', 'Yes'])).toBe('Yes')
    expect(defaultTrueValue(['L', 'R'])).toBe('L')
    expect(defaultTrueValue([])).toBeNull()
  })

  it('formats categorical and numeric previews', () => {
    expect(formatPreview(col('c', 'categorical', {
      n_unique: 5, preview: { top: [{ value: 'a', count: 1200 }, { value: 'b', count: 3 }] },
    }))).toBe('a (1,200), b (3), …')
    expect(formatPreview(col('s', 'float', { preview: { min: 0, median: 0.5, max: 12 } }))).toBe('0 · 0.500 · 12')
    expect(formatPreview(col('s', 'float', { preview: { min: null, median: null, max: null } }))).toBe('no values')
    expect(formatPreview(col('s', 'float', { preview: { min: 1663, median: 12435.5, max: 25000000.5 } })))
      .toBe('1,663 · 12,435.5 · 2.50e+7')
  })
})

describe('mergeDefaultName', () => {
  it('strips the per-dataset suffix a combine added', () => {
    expect(mergeDefaultName(['cell_type__A', 'cell_type__B'])).toBe('cell_type')
  })
  it('takes the common prefix without a trailing separator', () => {
    expect(mergeDefaultName(['leiden_1', 'leiden_2'])).toBe('leiden')
    expect(mergeDefaultName(['annot.fine', 'annot.coarse'])).toBe('annot')
  })
  it('does not cut a word in half', () => {
    // 'cell' is shared, but 'celltype' and 'cell_type' are not 'cell'.
    expect(mergeDefaultName(['celltype', 'cell_type'])).toBe('merged')
  })
  it('falls back when nothing is shared', () => {
    expect(mergeDefaultName(['a', 'b'])).toBe('merged')
    expect(mergeDefaultName([])).toBe('merged')
  })
  it('never returns a name in the taken list', () => {
    expect(mergeDefaultName(['cell_type', 'cell_type_copy'], ['cell_type', 'cell_type_copy'])).toBe('cell_type_merged')
    expect(mergeDefaultName(['a', 'b'], ['merged'])).toBe('merged_2')
  })
})
