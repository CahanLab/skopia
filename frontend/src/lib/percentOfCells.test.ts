import { describe, it, expect } from 'vitest'
import { percentOfCells, percentFromCells } from './percentOfCells'

describe('percentFromCells', () => {
  it('inverts percentOfCells for a dragged count', () => {
    for (const [count, n] of [[3, 2683], [10, 9773], [200, 200000], [1, 200]] as const) {
      expect(percentOfCells(percentFromCells(count, n), n)).toBe(count)
    }
  })

  it('is 0 for no cells or no count', () => {
    expect(percentFromCells(0, 1000)).toBe(0)
    expect(percentFromCells(5, 0)).toBe(0)
  })
})
