import { describe, expect, it } from 'vitest'
import { formatDuration, estimateRemaining } from './taskProgress'

describe('formatDuration', () => {
  it('prints seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(42.7)).toBe('42s')
  })
  it('prints minutes and seconds under an hour', () => {
    expect(formatDuration(61)).toBe('1m 01s')
    expect(formatDuration(3599)).toBe('59m 59s')
  })
  it('prints hours and minutes past an hour', () => {
    expect(formatDuration(3600 + 5 * 60 + 9)).toBe('1h 05m')
  })
})

describe('estimateRemaining', () => {
  it('extrapolates the elapsed rate', () => {
    expect(estimateRemaining(0.25, 30)).toBeCloseTo(90)
  })
  // Early on the rate is mostly startup cost (copying the data, building the
  // graph), so a guess would swing wildly; say nothing instead.
  it('declines to guess before 5% or before 3 seconds', () => {
    expect(estimateRemaining(0.04, 100)).toBeNull()
    expect(estimateRemaining(0.5, 2)).toBeNull()
  })
  it('has nothing to say once finished or without a fraction', () => {
    expect(estimateRemaining(1, 30)).toBeNull()
    expect(estimateRemaining(null, 30)).toBeNull()
  })
})
