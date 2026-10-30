import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEXT_STYLE,
  annotationsInView,
  backgroundRgba,
  clampEditorPosition,
  makeTextAnnotation,
  styleOf,
  textBlockLayout,
  viewTransform,
  type TextAnnotation,
} from './textAnnotations'

const base = (over: Partial<TextAnnotation> = {}): TextAnnotation =>
  makeTextAnnotation({ embeddingName: 'X_umap', dimX: 0, dimY: 1, x: 1, y: 2, text: 'a' }, DEFAULT_TEXT_STYLE, 'id1', over)

describe('makeTextAnnotation', () => {
  it('takes the given style and position, trims nothing from the text', () => {
    const t = makeTextAnnotation(
      { embeddingName: 'X_umap', dimX: 0, dimY: 1, x: 3, y: 4, text: ' Crest ' },
      { ...DEFAULT_TEXT_STYLE, color: '#e94560', fontSize: 20 },
      'abc',
    )
    expect(t).toMatchObject({ id: 'abc', x: 3, y: 4, text: ' Crest ', color: '#e94560', fontSize: 20, visible: true })
  })
})

describe('styleOf', () => {
  it('keeps only the style fields, so it can seed the next annotation', () => {
    const s = styleOf(base({ color: '#123456', angle: 30, background: '#000000' }))
    expect(s).toEqual({ ...DEFAULT_TEXT_STYLE, color: '#123456', angle: 30, background: '#000000' })
    expect(s).not.toHaveProperty('x')
    expect(s).not.toHaveProperty('text')
  })
})

describe('annotationsInView', () => {
  it('shows only visible notes drawn on this embedding and these two columns', () => {
    const notes = [
      base({ id: 'a' }),
      base({ id: 'b', embeddingName: 'X_pca' }),
      base({ id: 'c', dimX: 1, dimY: 2 }),
      base({ id: 'd', visible: false }),
    ]
    expect(annotationsInView(notes, 'X_umap', 0, 1).map((t) => t.id)).toEqual(['a'])
    expect(annotationsInView(notes, 'X_umap', 1, 2).map((t) => t.id)).toEqual(['c'])
  })
})

describe('viewTransform', () => {
  it('matches ScatterPlot: centre of the box is the view target, zoom is log2 scale', () => {
    const v = viewTransform([10, 20], 1, 200, 100)
    expect(v.toScreen(10, 20)).toEqual([100, 50])
    expect(v.toScreen(11, 20)).toEqual([102, 50])
    expect(v.toData(102, 50)).toEqual([11, 20])
  })
  it('round-trips', () => {
    const v = viewTransform([-3.5, 7], 2.7, 640, 480)
    const [sx, sy] = v.toScreen(1.25, -4)
    const [x, y] = v.toData(sx, sy)
    expect(x).toBeCloseTo(1.25, 10)
    expect(y).toBeCloseTo(-4, 10)
  })
})

describe('textBlockLayout', () => {
  const measure = (s: string) => s.length * 10
  it('centres a multi-line block vertically on the anchor point', () => {
    const l = textBlockLayout('ab\nabcd', 20, 'middle', measure)
    expect(l.lines).toEqual(['ab', 'abcd'])
    expect(l.width).toBe(40)
    expect(l.lineHeight).toBeCloseTo(24)
    expect(l.height).toBeCloseTo(48)
    // first baseline-middle sits half a line above centre for two lines
    expect(l.firstLineY).toBeCloseTo(-12)
  })
  it('puts the background box where the text actually is for each alignment', () => {
    expect(textBlockLayout('abcd', 10, 'start', measure).boxX).toBe(-4)
    expect(textBlockLayout('abcd', 10, 'middle', measure).boxX).toBe(-24)
    expect(textBlockLayout('abcd', 10, 'end', measure).boxX).toBe(-44)
  })
})

describe('backgroundRgba', () => {
  it('turns a hex colour and opacity into rgba', () => {
    expect(backgroundRgba('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)')
  })
  it('clamps opacity', () => {
    expect(backgroundRgba('#000000', 3)).toBe('rgba(0, 0, 0, 1)')
  })
})

describe('clampEditorPosition', () => {
  it('opens below-right of the point when there is room', () => {
    expect(clampEditorPosition(100, 100, 260, 200, 800, 600)).toEqual({ left: 112, top: 112 })
  })
  it('flips left and up near the far edges, never off the box', () => {
    expect(clampEditorPosition(780, 590, 260, 200, 800, 600)).toEqual({ left: 508, top: 378 })
    expect(clampEditorPosition(10, 10, 900, 900, 800, 600)).toEqual({ left: 0, top: 0 })
  })
})
