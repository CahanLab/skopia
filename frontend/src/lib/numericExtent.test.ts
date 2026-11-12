import { describe, expect, it } from 'vitest'
import { numericExtent } from './numericExtent'

describe('numericExtent', () => {
  it('returns the min and max, skipping nulls', () => {
    expect(numericExtent([3, null, -2, 7, null])).toEqual({ min: -2, max: 7 })
  })

  // Math.min(...values) throws "Maximum call stack size exceeded" somewhere
  // past ~125k arguments in Chrome, which blanked the whole app when a large
  // dataset was colored by a continuous .obs column.
  it('handles one value per cell on a large dataset', () => {
    const n = 500_000
    const values: (number | null)[] = new Array(n)
    for (let i = 0; i < n; i++) values[i] = i % 7 === 0 ? null : i
    values[12] = -5
    expect(numericExtent(values)).toEqual({ min: -5, max: n - 1 })
  })

  it('reads a boolean column as 0/1, as Math.min did', () => {
    expect(numericExtent([true, false, true])).toEqual({ min: 0, max: 1 })
  })

  it('ignores non-finite values', () => {
    expect(numericExtent([NaN, 2, Infinity, -Infinity, 4])).toEqual({ min: 2, max: 4 })
  })

  it('gives 0..0 rather than Infinity..-Infinity when nothing is numeric', () => {
    expect(numericExtent([null, null])).toEqual({ min: 0, max: 0 })
    expect(numericExtent([])).toEqual({ min: 0, max: 0 })
  })
})
