import { describe, it, expect } from 'vitest'
import {
  toChartSpace,
  fromChartSpace,
  formatCount,
  passingCount,
  median,
  mad,
  madBounds,
} from './filterCellsQc'

describe('log-axis mapping', () => {
  it('is the identity when log is off', () => {
    expect(toChartSpace(250, false)).toBe(250)
    expect(fromChartSpace(250, false)).toBe(250)
  })

  it('maps through log10(1+x) and back', () => {
    expect(toChartSpace(0, true)).toBe(0)
    expect(toChartSpace(999, true)).toBeCloseTo(3, 5)
    expect(fromChartSpace(3, true)).toBe(999)
  })

  it('round-trips integers exactly', () => {
    for (const v of [0, 1, 7, 250, 12345]) {
      expect(fromChartSpace(toChartSpace(v, true), true)).toBe(v)
    }
  })
})

describe('formatCount', () => {
  it('keeps small numbers plain and compacts thousands', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(950)).toBe('950')
    expect(formatCount(1200)).toBe('1.2k')
    expect(formatCount(48000)).toBe('48k')
  })
})

describe('passingCount', () => {
  const counts = [3, 10, 1, 30, 6]
  const genes = [3, 2, 1, 3, 2]

  it('applies all bounds inclusively, like the backend mask', () => {
    expect(passingCount(counts, genes, { minCounts: 3, maxCounts: 20, minGenes: 2 })).toBe(3)
    expect(passingCount(counts, genes, { minCounts: 3, maxCounts: 30 })).toBe(4)
  })

  it('counts everything when no bounds are set', () => {
    expect(passingCount(counts, genes, {})).toBe(5)
  })

  it('a null count fails any counts bound, as it would server-side', () => {
    expect(passingCount([3, null, 6], [1, 1, 1], { minCounts: 1 })).toBe(2)
    expect(passingCount([3, null, 6], [1, 1, 1], { maxCounts: 100 })).toBe(2)
    expect(passingCount([3, null, 6], [1, 1, 1], {})).toBe(3)
  })
})

describe('passingCount with the mitochondrial share', () => {
  const counts = [4, 10, 4, 20, 0]
  const genes = [4, 2, 2, 2, 0]
  const pctMt = [50, 0, 100, 25, 0]

  it('applies min/max % mito inclusively alongside the other bounds', () => {
    expect(passingCount(counts, genes, { maxPctMt: 25 }, pctMt)).toBe(3)
    expect(passingCount(counts, genes, { maxPctMt: 25, minCounts: 1 }, pctMt)).toBe(2)
    expect(passingCount(counts, genes, { minPctMt: 25, maxPctMt: 25 }, pctMt)).toBe(1)
  })

  it('a % mito bound with no mito distribution fails every cell, as the backend refuses it', () => {
    expect(passingCount(counts, genes, { maxPctMt: 25 }, null)).toBe(0)
    expect(passingCount(counts, genes, {}, null)).toBe(5)
  })
})

describe('fromChartSpace decimals', () => {
  it('keeps two places for a percentage', () => {
    expect(fromChartSpace(7.3456, false, 2)).toBe(7.35)
    expect(fromChartSpace(7.3456, false)).toBe(7)
  })
})

describe('median and MAD', () => {
  it('median of odd and even lengths', () => {
    expect(median([1, 3, 2].sort((a, b) => a - b))).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('MAD is unscaled: the median absolute deviation itself', () => {
    // scipy.stats.median_abs_deviation([1, 2, 3, 4, 100]) == 1.0
    expect(mad([1, 2, 3, 4, 100])).toBe(1)
  })
})

describe('madBounds', () => {
  // median 10, MAD 2 on the linear axis → k=1.5: [7, 13]
  const values = [6, 8, 9, 10, 10, 11, 12, 14, 40]

  it('places both cutoffs at median ± k·MAD on a linear axis', () => {
    expect(madBounds(values, 1.5, false)).toEqual({ lo: 7, hi: 13 })
  })

  it('drops a cutoff that falls at or beyond the data', () => {
    // k=2 → lo 6 (the minimum itself → null), hi 14 (within: 40 is above it)
    expect(madBounds(values, 2, false)).toEqual({ lo: null, hi: 14 })
    expect(madBounds(values, 100, false)).toEqual({ lo: null, hi: null })
  })

  it('measures on the log axis when asked and returns data units', () => {
    const logVals = [10, 100, 1000, 10000, 100000]  // log10(1+x) ≈ 1..5, median 3, MAD 1
    const b = madBounds(logVals, 1, true)
    expect(b.lo).toBeCloseTo(100, -1)
    expect(b.hi).toBeCloseTo(10000, -2)
  })

  it('ignores nulls and non-positive k', () => {
    expect(madBounds([null, 1, 2, 3], 0, false)).toEqual({ lo: null, hi: null })
    expect(madBounds([null, null], 2, false)).toEqual({ lo: null, hi: null })
  })

  it('rounds to the requested decimals', () => {
    // median 3.885, MAD 1.665
    expect(madBounds([1.11, 2.22, 3.33, 4.44, 5.55, 20], 1, false, 2)).toEqual({ lo: 2.22, hi: 5.55 })
  })
})
