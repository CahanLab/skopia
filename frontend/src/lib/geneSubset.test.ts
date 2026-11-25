import { describe, it, expect } from 'vitest'
import { resolveGeneSubset, geneSubsetLabel, describeGeneSubsetType, type GeneSubsetSelection, geneColumnsAfterRefresh } from './geneSubset'

const sel = (over: Partial<GeneSubsetSelection> = {}): GeneSubsetSelection => ({
  columns: [],
  geneSets: [],
  operation: 'intersection',
  ...over,
})

const A = { name: 'A', genes: ['Foo', 'Bar', 'Baz'] }
const B = { name: 'B', genes: ['Bar', 'Qux'] }

describe('resolveGeneSubset', () => {
  it('is null when nothing is chosen — the backend reads that as all genes', () => {
    expect(resolveGeneSubset(sel())).toBeNull()
  })

  it('sends a single .var column as a bare string', () => {
    expect(resolveGeneSubset(sel({ columns: ['highly_variable'] }))).toBe('highly_variable')
  })

  it('sends two or more columns as a combine spec', () => {
    expect(resolveGeneSubset(sel({ columns: ['hvg', 'expressed'], operation: 'union' })))
      .toEqual({ columns: ['hvg', 'expressed'], operation: 'union' })
  })

  it('sends one gene set as its gene list', () => {
    expect(resolveGeneSubset(sel({ geneSets: [A] }))).toEqual(['Foo', 'Bar', 'Baz'])
  })

  it('intersects several gene sets', () => {
    expect(resolveGeneSubset(sel({ geneSets: [A, B], operation: 'intersection' }))).toEqual(['Bar'])
  })

  it('unions several gene sets, first-appearance order, no duplicates', () => {
    expect(resolveGeneSubset(sel({ geneSets: [A, B], operation: 'union' })))
      .toEqual(['Foo', 'Bar', 'Baz', 'Qux'])
  })

  it('returns an empty list when a combination selects nothing', () => {
    // Not null: null means "all genes", and silently testing 20k genes because
    // an intersection came up empty is the wrong answer to give.
    const disjoint = [{ name: 'A', genes: ['Foo'] }, { name: 'B', genes: ['Bar'] }]
    expect(resolveGeneSubset(sel({ geneSets: disjoint, operation: 'intersection' }))).toEqual([])
  })

  it('lets gene sets win over columns, so a stale column can never leak in', () => {
    expect(resolveGeneSubset(sel({ geneSets: [A], columns: ['highly_variable'] })))
      .toEqual(['Foo', 'Bar', 'Baz'])
  })

  it('ignores gene sets that carry no genes', () => {
    expect(resolveGeneSubset(sel({ geneSets: [{ name: 'empty', genes: [] }] }))).toBeNull()
  })
})

describe('geneSubsetLabel', () => {
  it('says all when nothing is chosen', () => {
    expect(geneSubsetLabel(sel())).toBe('all genes')
  })

  it('names a single gene set and its size', () => {
    expect(geneSubsetLabel(sel({ geneSets: [A] }))).toBe('A (3 genes)')
  })

  it('spells out the combination for several gene sets', () => {
    expect(geneSubsetLabel(sel({ geneSets: [A, B], operation: 'union' }))).toBe('A ∪ B (4 genes)')
    expect(geneSubsetLabel(sel({ geneSets: [A, B], operation: 'intersection' }))).toBe('A ∩ B (1 gene)')
  })

  it('warns when a combination is empty', () => {
    const disjoint = [{ name: 'A', genes: ['Foo'] }, { name: 'B', genes: ['Bar'] }]
    expect(geneSubsetLabel(sel({ geneSets: disjoint, operation: 'intersection' })))
      .toBe('A ∩ B (no genes)')
  })

  it('names columns', () => {
    expect(geneSubsetLabel(sel({ columns: ['highly_variable'] }))).toBe('highly_variable')
    expect(geneSubsetLabel(sel({ columns: ['a', 'b'], operation: 'intersection' }))).toBe('a AND b')
    expect(geneSubsetLabel(sel({ columns: ['a', 'b'], operation: 'union' }))).toBe('a OR b')
  })
})

describe('describeGeneSubsetType', () => {
  it('reads back what the result says the test ran on', () => {
    expect(describeGeneSubsetType('all')).toBe('all genes')
    expect(describeGeneSubsetType('gene_list')).toBe('gene list')
    expect(describeGeneSubsetType('column:highly_variable')).toBe('highly_variable')
    expect(describeGeneSubsetType('intersection:hvg+expressed')).toBe('hvg AND expressed')
    expect(describeGeneSubsetType('union:hvg+expressed')).toBe('hvg OR expressed')
  })

  it('passes through anything it does not recognise', () => {
    expect(describeGeneSubsetType('something_new')).toBe('something_new')
  })
})

describe('geneColumnsAfterRefresh', () => {
  const cols = ['analysis_genes', 'highly_variable']

  it('shows the default until the user touches a pill, once its column exists', () => {
    expect(geneColumnsAfterRefresh([], [], 'highly_variable', false)).toEqual([])
    expect(geneColumnsAfterRefresh([], cols, 'highly_variable', false)).toEqual(['highly_variable'])
    expect(geneColumnsAfterRefresh([], cols, null, false)).toEqual([])
  })

  it('keeps the picked columns when the column list is re-read after a run', () => {
    expect(geneColumnsAfterRefresh(['analysis_genes'], cols, null, true)).toEqual(['analysis_genes'])
    expect(geneColumnsAfterRefresh(['analysis_genes'], cols, 'highly_variable', true)).toEqual(['analysis_genes'])
  })

  it('drops a picked column that no longer exists', () => {
    expect(geneColumnsAfterRefresh(['analysis_genes', 'gone'], cols, null, true)).toEqual(['analysis_genes'])
  })

  it('never re-imposes the default after the user cleared it', () => {
    expect(geneColumnsAfterRefresh([], cols, 'highly_variable', true)).toEqual([])
  })
})
