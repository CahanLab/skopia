import { describe, it, expect } from 'vitest'
import { orderSelectedSets, groupLabel, folderSelectionState, restoreSelectedIds, toggleGroupPick, cleanGroupPick } from './heatmapGroups'

// A pathway is a folder of role sets in a fixed order (ligands, receptors,
// …). The heatmap should show a picked pathway in that order, and when sets
// from several pathways are mixed, each row group should say which pathway
// it belongs to — "Wnt (canonical) · ligands" — since every pathway has a
// "ligands" set.

type S = { id: string; name: string; genes: string[]; category: string; folderName?: string }
const set = (id: string, name: string, folderName?: string): S =>
  ({ id, name, genes: [id], category: 'manual', folderName })

const all: S[] = [
  set('w1', 'ligands', 'Wnt (canonical)'),
  set('w2', 'receptors', 'Wnt (canonical)'),
  set('w3', 'effectors', 'Wnt (canonical)'),
  set('b1', 'ligands', 'BMP'),
  set('b2', 'receptors', 'BMP'),
  set('m1', 'my markers'),
]

describe('orderSelectedSets', () => {
  it('keeps folder order and each folder\'s own set order whatever the click order', () => {
    const picked = new Set(['b2', 'w3', 'w1', 'b1'])
    expect(orderSelectedSets(all, picked).map((s) => s.id)).toEqual(['w1', 'w3', 'b1', 'b2'])
  })
  it('leaves loose sets where they are', () => {
    expect(orderSelectedSets(all, new Set(['m1', 'w2'])).map((s) => s.id)).toEqual(['w2', 'm1'])
  })
})

describe('groupLabel', () => {
  it('is just the role when every picked set comes from one folder', () => {
    const picked = orderSelectedSets(all, new Set(['w1', 'w2']))
    expect(picked.map((s) => groupLabel(s, picked))).toEqual(['ligands', 'receptors'])
  })
  it('carries the pathway when folders are mixed, so "ligands" is not ambiguous', () => {
    const picked = orderSelectedSets(all, new Set(['w1', 'b1']))
    expect(picked.map((s) => groupLabel(s, picked))).toEqual(['Wnt (canonical) · ligands', 'BMP · ligands'])
  })
  it('a loose set among folders keeps its own name', () => {
    const picked = orderSelectedSets(all, new Set(['w1', 'm1']))
    expect(picked.map((s) => groupLabel(s, picked))).toEqual(['Wnt (canonical) · ligands', 'my markers'])
  })
})

describe('folderSelectionState', () => {
  it('reports none, some or all of a folder\'s sets picked', () => {
    expect(folderSelectionState(all, 'Wnt (canonical)', new Set())).toBe('none')
    expect(folderSelectionState(all, 'Wnt (canonical)', new Set(['w1']))).toBe('some')
    expect(folderSelectionState(all, 'Wnt (canonical)', new Set(['w1', 'w2', 'w3']))).toBe('all')
  })
})

describe('restoreSelectedIds', () => {
  const sets = [set('w1', 'ligands', 'Wnt (canonical)'), set('b1', 'ligands', 'BMP'), set('m1', 'my markers')]
  it('restores by id when the applied config carries one', () => {
    const applied = [{ id: 'b1', name: 'BMP · ligands', genes: ['b1'] }]
    expect(Array.from(restoreSelectedIds(applied, sets))).toEqual(['b1'])
  })
  it('falls back to name and gene count for a config saved without ids', () => {
    const applied = [{ name: 'my markers', genes: ['m1'] }]
    expect(Array.from(restoreSelectedIds(applied, sets))).toEqual(['m1'])
  })
  it('does not guess between same-named sets without an id', () => {
    const applied = [{ name: 'ligands', genes: ['x'] }]
    expect(restoreSelectedIds(applied, sets).size).toBe(0)
  })
})

describe('toggleGroupPick', () => {
  const all = ['0', '1', '2', '3']
  it('unticking one of all leaves the rest, in the column order', () => {
    expect(toggleGroupPick(null, all, '1')).toEqual(['0', '2', '3'])
  })
  it('ticking the last missing one is "all" again (null)', () => {
    expect(toggleGroupPick(['0', '2', '3'], all, '1')).toBeNull()
  })
  it('a pick keeps the column order whatever order it was clicked in', () => {
    expect(toggleGroupPick(['3'], all, '0')).toEqual(['0', '3'])
  })
  it('the last group cannot be unticked', () => {
    expect(toggleGroupPick(['2'], all, '2')).toEqual(['2'])
  })
})

describe('cleanGroupPick', () => {
  it('drops labels the column no longer has, and an emptied pick means all', () => {
    expect(cleanGroupPick(['0', 'gone'], ['0', '1'])).toEqual(['0'])
    expect(cleanGroupPick(['gone'], ['0', '1'])).toBeNull()
    expect(cleanGroupPick(null, ['0'])).toBeNull()
  })
  it('leaves the pick alone while the labels are not known yet', () => {
    expect(cleanGroupPick(['0'], [])).toEqual(['0'])
  })
})

// Dragging: the picker lists every label in a display order the user can
// rearrange; the pick sent is the ticked labels in that order.
describe('dragging groups', () => {
  const all = ['0', '1', '2', '3']
  it('moveItem moves one entry to an index, the others keep their order', async () => {
    const { moveItem } = await import('./heatmapGroups')
    expect(moveItem(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b'], 'zz', 0)).toEqual(['a', 'b'])
  })
  it('the display order is the column order until a pick is out of it', async () => {
    const { groupDisplayOrder } = await import('./heatmapGroups')
    expect(groupDisplayOrder(null, null, all)).toEqual(all)
    // a pick made by ticking is in column order: nobody jumps
    expect(groupDisplayOrder(null, ['0', '2'], all)).toEqual(all)
    // a pick restored from a dragged config: its order first, the rest after
    expect(groupDisplayOrder(null, ['3', '1'], all)).toEqual(['3', '1', '0', '2'])
    // a dragged order wins, minus gone labels, plus new ones at the end
    expect(groupDisplayOrder(['2', 'gone', '0'], null, all)).toEqual(['2', '0', '1', '3'])
  })
  it('a pick follows the display order, and only the column order collapses to all', async () => {
    const { pickInOrder } = await import('./heatmapGroups')
    expect(pickInOrder(null, ['3', '2', '1', '0'], all)).toEqual(['3', '2', '1', '0'])
    expect(pickInOrder(['0', '2'], ['2', '1', '0', '3'], all)).toEqual(['2', '0'])
    expect(pickInOrder(['3', '2', '1', '0'], all, all)).toBeNull()
  })
  it('ticking in a dragged order keeps the dragged order', () => {
    const order = ['3', '1', '0', '2']
    expect(toggleGroupPick(['3', '1'], all, '2', order)).toEqual(['3', '1', '2'])
    expect(toggleGroupPick(null, all, '1', order)).toEqual(['3', '0', '2'])
    // every label ticked but out of column order is a pick, not "all"
    expect(toggleGroupPick(['3', '1', '0'], all, '2', order)).toEqual(['3', '1', '0', '2'])
  })
})

describe('gene-set row order', () => {
  const sets = [
    { id: 'a', name: 'A', genes: ['x'] }, { id: 'b', name: 'B', genes: ['y'] },
    { id: 'c', name: 'C', genes: ['z'] }, { id: 'd', name: 'D', genes: ['w'] },
  ]
  it('a dragged order wins; sets ticked after the drag follow in list order', () => {
    const picked = new Set(['a', 'c', 'd'])
    expect(orderSelectedSets(sets, picked, ['d', 'a']).map((s) => s.id)).toEqual(['d', 'a', 'c'])
    expect(orderSelectedSets(sets, picked, ['b', 'd', 'a', 'c']).map((s) => s.id)).toEqual(['d', 'a', 'c'])
    expect(orderSelectedSets(sets, picked, null).map((s) => s.id)).toEqual(['a', 'c', 'd'])
  })
  it('a saved config in list order restores no custom order; a dragged one restores it', async () => {
    const { restoreSetOrder } = await import('./heatmapGroups')
    expect(restoreSetOrder([{ id: 'a', name: 'A', genes: ['x'] }, { id: 'c', name: 'C', genes: ['z'] }], sets)).toBeNull()
    expect(restoreSetOrder([{ id: 'c', name: 'C', genes: ['z'] }, { id: 'a', name: 'A', genes: ['x'] }], sets)).toEqual(['c', 'a'])
  })
})
