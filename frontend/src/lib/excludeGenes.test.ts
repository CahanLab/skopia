import { describe, it, expect } from 'vitest'
import { excludeGenePatternsFor, EXCLUDE_GENE_PATTERNS, DEFAULT_EXCLUDE_GENE_PATTERNS } from './excludeGenes'

describe('excludeGenePatternsFor', () => {
  it('switches the stock mouse default to the human list for a human dataset', () => {
    expect(excludeGenePatternsFor('human', DEFAULT_EXCLUDE_GENE_PATTERNS)).toBe('^MT-, ^ENS, ^RPS, ^RPL, ^LINC')
  })

  it('leaves a mouse dataset on the stock default', () => {
    expect(excludeGenePatternsFor('mouse', DEFAULT_EXCLUDE_GENE_PATTERNS)).toBeNull()
  })

  it('never overwrites an edited or user-configured field', () => {
    expect(excludeGenePatternsFor('human', '^MT-')).toBeNull()
    expect(excludeGenePatternsFor('human', null)).toBeNull()
  })

  it('does nothing for an unknown species', () => {
    expect(excludeGenePatternsFor(null, DEFAULT_EXCLUDE_GENE_PATTERNS)).toBeNull()
    expect(excludeGenePatternsFor('zebrafish', DEFAULT_EXCLUDE_GENE_PATTERNS)).toBeNull()
  })

  it('every preset is a comma-separated list of valid regexes', () => {
    for (const list of Object.values(EXCLUDE_GENE_PATTERNS)) {
      for (const p of list.split(',').map((s) => s.trim())) expect(() => new RegExp(p)).not.toThrow()
    }
  })
})
