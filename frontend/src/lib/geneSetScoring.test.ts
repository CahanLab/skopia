import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GENE_SET_SCORING, scoringFromDisplay, scoringParams, scoringSummary,
  SCORING_METHOD_OPTIONS, PER_GENE_NORM_OPTIONS, AGGREGATION_OPTIONS,
} from './geneSetScoring'
import { defaultDisplayPreferences } from '../store'

describe('gene-set scoring for Expression aggregates', () => {
  it('defaults to the Display defaults', () => {
    const dp = defaultDisplayPreferences()
    expect(DEFAULT_GENE_SET_SCORING).toEqual({
      scoringMethod: dp.geneSetScoringMethod, perGeneNorm: dp.geneSetPerGeneNorm,
      perGeneClip: dp.geneSetPerGeneClip, aggregation: dp.geneSetAggregation,
    })
  })
  it('starts from what Display is set to now', () => {
    const dp = { ...defaultDisplayPreferences(), geneSetPerGeneNorm: 'rank' as const, geneSetAggregation: 'max' as const }
    expect(scoringFromDisplay(dp)).toMatchObject({ perGeneNorm: 'rank', aggregation: 'max' })
  })
  it('goes on the wire under the backend names', () => {
    expect(scoringParams({ scoringMethod: 'ucell', perGeneNorm: 'none', perGeneClip: 2, aggregation: 'sum' })).toEqual({
      gene_set_scoring_method: 'ucell', gene_set_per_gene_norm: 'none', gene_set_per_gene_clip: 2, gene_set_aggregation: 'sum',
    })
  })
  it('offers exactly the backend options', () => {
    expect(SCORING_METHOD_OPTIONS.map((o) => o.value)).toEqual(['mean', 'ucell'])
    expect(PER_GENE_NORM_OPTIONS.map((o) => o.value)).toEqual(['none', 'zscore_mad', 'zscore_sd', 'minmax', 'rank'])
    expect(AGGREGATION_OPTIONS.map((o) => o.value)).toEqual(['mean', 'median', 'sum', 'max'])
  })
  it('"None" says what it does: no per-gene scaling, not raw counts', () => {
    expect(PER_GENE_NORM_OPTIONS[0].label).toBe('None (no per-gene scaling)')
  })
  it('summarises a setting for the toolbar', () => {
    expect(scoringSummary(DEFAULT_GENE_SET_SCORING)).toBe('z-score (MAD), mean')
    expect(scoringSummary({ ...DEFAULT_GENE_SET_SCORING, perGeneNorm: 'minmax', perGeneClip: 1 })).toBe('min-max (clip 1%), mean')
    expect(scoringSummary({ ...DEFAULT_GENE_SET_SCORING, scoringMethod: 'ucell' })).toBe('UCell')
  })
})
