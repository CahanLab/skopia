import { describe, expect, it } from 'vitest'
import { highlightSizeFn } from './cellColors'
import type { HighlightLayer } from '../store'

const geneset = (values: (number | null)[], lo: number, extra: Partial<HighlightLayer> = {}): HighlightLayer => ({
  id: `g${lo}`,
  color: '#22c55e',
  intensity: 0.85,
  source: { kind: 'geneset', label: 'set', genes: ['A'], values, min: 0, max: 1, thresholdMode: 'above', lo, hi: lo },
  ...extra,
})

const cellset = (mask: boolean[], extra: Partial<HighlightLayer> = {}): HighlightLayer => ({
  id: 'c',
  color: '#06b6d4',
  intensity: 0.85,
  source: { kind: 'cellset', label: 'cells', mask: Uint8Array.from(mask.map(Number)) },
  ...extra,
})

describe('highlightSizeFn', () => {
  it('is null when no layer changes the size, so the plot keeps its fast path', () => {
    expect(highlightSizeFn([])).toBeNull()
    expect(highlightSizeFn([geneset([1, 2], 1)])).toBeNull()
    expect(highlightSizeFn([geneset([1, 2], 1, { size: 1 })])).toBeNull()
  })

  it('scales only the cells that pass the threshold', () => {
    const f = highlightSizeFn([geneset([0.1, 0.9, null], 0.5, { size: 2.5 })])!
    expect(f(0)).toBe(1)
    expect(f(1)).toBe(2.5)
    expect(f(2)).toBe(1)
  })

  it('follows membership, not opacity: a 0% layer can still enlarge its cells', () => {
    const f = highlightSizeFn([geneset([0.9], 0.5, { size: 2, intensity: 0 })])!
    expect(f(0)).toBe(2)
  })

  it('takes the largest size among the layers a cell is in', () => {
    const f = highlightSizeFn([
      geneset([0.9, 0.9, 0.1], 0.5, { size: 1.5 }),
      cellset([false, true, false], { size: 3 }),
    ])!
    expect([f(0), f(1), f(2)]).toEqual([1.5, 3, 1])
  })
})
