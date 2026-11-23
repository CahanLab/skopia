import { describe, it, expect } from 'vitest'
import { suggestVarColumnName } from './varColumnName'

describe('suggestVarColumnName', () => {
  it('keeps a plain set name', () => {
    expect(suggestVarColumnName('pluripotency')).toBe('pluripotency')
    expect(suggestVarColumnName('Wnt_ligands')).toBe('Wnt_ligands')
  })
  it('turns spaces and punctuation into single underscores', () => {
    expect(suggestVarColumnName('Wnt · ligands (core)')).toBe('Wnt_ligands_core')
    expect(suggestVarColumnName('  HALLMARK/E2F targets ')).toBe('HALLMARK_E2F_targets')
  })
  it('never starts with a digit and is never empty', () => {
    expect(suggestVarColumnName('3 prime')).toBe('set_3_prime')
    expect(suggestVarColumnName('···')).toBe('gene_set')
  })
})
