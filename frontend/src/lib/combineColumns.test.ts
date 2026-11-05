import { describe, it, expect } from 'vitest'
import { chooseSameAs, mergeTargets, offerableSameAs, seedPolicy, splitObsPolicy, summarizePolicy, type ColumnInfo } from './combineColumns'

const cols: ColumnInfo[] = [
  { name: 'nCount_RNA', datasets: ['A', 'B'], kind: 'numeric', suggested: 'merge', reason: 'r' },
  { name: 'clusters', datasets: ['A', 'B'], kind: 'category', suggested: 'separate', reason: 'r' },
  { name: 'only_a', datasets: ['A'], kind: 'numeric', suggested: 'merge', reason: 'r' },
]

describe('seedPolicy', () => {
  it('starts every column on its suggestion', () => {
    expect(seedPolicy(cols)).toEqual({
      nCount_RNA: 'merge', clusters: 'separate', only_a: 'merge',
    })
  })

  it('keeps a choice the user already made', () => {
    expect(seedPolicy(cols, { clusters: 'drop' }).clusters).toBe('drop')
  })

  it('forgets choices for columns that are no longer offered', () => {
    // Removing a file changes the column list; a stale entry would be sent to
    // the backend, which rejects a policy naming a column no dataset has.
    expect(seedPolicy(cols, { gone: 'merge' })).not.toHaveProperty('gone')
  })
})

describe('summarizePolicy', () => {
  it('counts each outcome', () => {
    expect(summarizePolicy(cols, seedPolicy(cols))).toBe('2 merged · 1 kept separate')
  })

  it('mentions drops', () => {
    const p = { ...seedPolicy(cols), only_a: 'drop' }
    expect(summarizePolicy(cols, p)).toBe('1 merged · 1 kept separate · 1 dropped')
  })

  it('says so when nothing is kept', () => {
    const p = Object.fromEntries(cols.map((c) => [c.name, 'drop']))
    expect(summarizePolicy(cols, p)).toBe('3 dropped')
  })

  it('handles an empty column list', () => {
    expect(summarizePolicy([], {})).toBe('none')
  })
})

describe('same-as policies', () => {
  const renamed: ColumnInfo[] = [
    { name: 'celltype', datasets: ['A'], kind: 'category', suggested: 'merge', reason: 'r',
      same_as: [{ name: 'cell_type', shared: 2, union: 4, likely: true }] },
    { name: 'cell_type', datasets: ['B'], kind: 'category', suggested: 'merge', reason: 'r',
      same_as: [{ name: 'celltype', shared: 2, union: 4, likely: true }] },
    { name: 'nCount_RNA', datasets: ['A', 'B'], kind: 'numeric', suggested: 'merge', reason: 'r' },
  ]

  it('splits the request into a policy and a merge map', () => {
    expect(splitObsPolicy({ celltype: 'same:cell_type', cell_type: 'merge', nCount_RNA: 'drop' })).toEqual({
      obs_policy: { cell_type: 'merge', nCount_RNA: 'drop' },
      obs_merge_into: { celltype: 'cell_type' },
    })
  })

  it('splits on the first colon only, so a target name may contain one', () => {
    expect(splitObsPolicy({ a: 'same:x:y' }).obs_merge_into).toEqual({ a: 'x:y' })
  })

  it('lists the sources each target receives', () => {
    expect(mergeTargets({ celltype: 'same:cell_type', other: 'same:cell_type', cell_type: 'merge' }))
      .toEqual({ cell_type: ['celltype', 'other'] })
  })

  it('counts a same-as column as merged', () => {
    expect(summarizePolicy(renamed, { celltype: 'same:cell_type', cell_type: 'merge', nCount_RNA: 'merge' }))
      .toBe('3 merged')
  })

  it('forgets a same-as whose target is no longer offered', () => {
    // Removing B's file removes cell_type; the backend rejects a merge into
    // a column no dataset has.
    const withoutB = renamed.filter((c) => c.name !== 'cell_type')
    expect(seedPolicy(withoutB, { celltype: 'same:cell_type' }).celltype).toBe('merge')
  })

  it('keeps a same-as whose target is still offered', () => {
    expect(seedPolicy(renamed, { celltype: 'same:cell_type' }).celltype).toBe('same:cell_type')
  })
})

describe('chooseSameAs', () => {
  it('sets the source and forces the target to one column, whatever it held', () => {
    expect(chooseSameAs({ a: 'merge', b: 'drop' }, 'a', 'b')).toEqual({ a: 'same:b', b: 'merge' })
  })
  it('leaves other columns alone', () => {
    expect(chooseSameAs({ a: 'merge', b: 'separate', c: 'drop' }, 'a', 'b').c).toBe('drop')
  })
})

describe('offerableSameAs', () => {
  const col: ColumnInfo = {
    name: 'a', datasets: ['A'], kind: 'category', suggested: 'merge', reason: 'r',
    same_as: [
      { name: 'b', shared: 2, union: 4, likely: true },
      { name: 'c', shared: 0, union: 5, likely: false },
    ],
  }
  it('offers every candidate the backend listed', () => {
    expect(offerableSameAs(col, { a: 'merge', b: 'merge', c: 'merge' }).map((c) => c.name)).toEqual(['b', 'c'])
  })
  it('never offers a column that is itself a same-as source, so no chain can be built', () => {
    expect(offerableSameAs(col, { a: 'merge', b: 'same:c', c: 'merge' }).map((c) => c.name)).toEqual(['c'])
  })
})
