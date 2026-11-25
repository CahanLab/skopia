import { describe, it, expect } from 'vitest'
import {
  EMPTY_SELECTION,
  excludeGenesBody,
  mitoWarning,
  proteinCodingOnly,
  selectionIsEmpty,
  summaryLine,
  type GeneTypeSummary,
} from './geneTypes'

function summary(classes: string[], sets: string[], species: string | null = 'mouse'): GeneTypeSummary {
  return {
    species,
    available_species: ['human', 'mouse'],
    source: species ? { kind: 'gencode', label: 'GENCODE M23 + M39', species } : null,
    n_genes: 100,
    matched: { ensembl_id: 0, symbol: 90, file: 0, unmatched: 10 },
    classes: classes.map((name) => ({ name, n: 1, examples: [] })),
    sets: sets.map((name) => ({ name, description: '', n: 1, examples: [], computed_by: 'skopia' })),
    selection: null,
  }
}

const GENCODE_CLASSES = ['protein_coding', 'lncRNA', 'pseudogene', 'small_rna', 'ig_tr', 'other', 'unannotated']

describe('proteinCodingOnly', () => {
  it('ticks every class but protein_coding and unannotated, plus mt, ribo and predicted', () => {
    const sel = proteinCodingOnly(summary(GENCODE_CLASSES, ['mt', 'ribo', 'hb', 'predicted', 'x_linked']))
    expect(sel).toEqual({
      classes: ['lncRNA', 'pseudogene', 'small_rna', 'ig_tr', 'other'],
      sets: ['mt', 'ribo', 'predicted'],
      species: 'mouse',
    })
  })

  it("leaves a cryten file's exogenous class unticked, like unannotated", () => {
    const sel = proteinCodingOnly(summary([...GENCODE_CLASSES, 'exogenous'], ['mt', 'ribo', 'predicted']))
    expect(sel.classes).not.toContain('exogenous')
    expect(sel.classes).not.toContain('unannotated')
  })

  it('ticks only the sets the summary offers', () => {
    expect(proteinCodingOnly(summary(GENCODE_CLASSES, ['ribo'])).sets).toEqual(['ribo'])
  })
})

describe('selectionIsEmpty', () => {
  it('is true with no class and no set, whatever the species', () => {
    expect(selectionIsEmpty(EMPTY_SELECTION)).toBe(true)
    expect(selectionIsEmpty({ classes: [], sets: [], species: 'human' })).toBe(true)
    expect(selectionIsEmpty({ classes: ['lncRNA'], sets: [], species: null })).toBe(false)
    expect(selectionIsEmpty({ classes: [], sets: ['mt'], species: null })).toBe(false)
  })
})

describe('excludeGenesBody', () => {
  it('parses names by line and patterns by comma, dropping blanks, as the modal always has', () => {
    expect(excludeGenesBody('Gnai3\n\n  Actb \n', ' ^mt-, ,^Rps ', EMPTY_SELECTION)).toEqual({
      gene_names: ['Gnai3', 'Actb'],
      patterns: ['^mt-', '^Rps'],
      types: null,
    })
  })

  it('sends an empty selection as types: null and blank fields as null', () => {
    const sel = { classes: ['lncRNA'], sets: [], species: 'mouse' }
    expect(excludeGenesBody('', '  ', sel)).toEqual({ gene_names: null, patterns: null, types: sel })
  })

  it('refuses when names, patterns and types are all empty', () => {
    expect(excludeGenesBody(' ', '', EMPTY_SELECTION)).toEqual({
      error: 'Provide gene names, a regex pattern or a gene type.',
    })
  })
})

describe('summaryLine', () => {
  it('states the removal and what remains', () => {
    expect(summaryLine({ n_removed: 10912, n_kept: 21373, examples: [], n_added_by_names_patterns: 0, added_examples: [] }))
      .toBe('Removes 10,912 genes, keeps 21,373.')
  })

  it('says what the names and patterns add beyond the types', () => {
    expect(summaryLine({ n_removed: 12, n_kept: 3, examples: [], n_added_by_names_patterns: 7, added_examples: ['Rps6ka1', 'Rps6kb1'] }))
      .toBe('Removes 12 genes, keeps 3. Names and patterns add 7 beyond the types (Rps6ka1, Rps6kb1, ...).')
    expect(summaryLine({ n_removed: 1, n_kept: 1, examples: [], n_added_by_names_patterns: 1, added_examples: ['Rps6ka1'] }))
      .toBe('Removes 1 gene, keeps 1. Names and patterns add 1 beyond the types (Rps6ka1).')
  })
})

describe('mitoWarning', () => {
  it('warns only when the mt set is ticked', () => {
    expect(mitoWarning({ classes: [], sets: ['mt'], species: null })).toMatch(/Filter Cells/)
    expect(mitoWarning({ classes: ['lncRNA'], sets: ['ribo'], species: null })).toBeNull()
  })
})
