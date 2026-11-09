// Text annotations placed on an embedding. Position is in the embedding's
// data coordinates, so a note stays on its cells under pan and zoom; size is
// in screen pixels, like the axis labels of every plotting tool. Stored with
// the dataset in uns['skopia_text_annotations_json'] (see the adaptor).

import { pointInPolygon, transformPoint, type Pt, type ShapeAffine } from '../utils/shapeTransform'

export type TextAnchor = 'start' | 'middle' | 'end'

export interface TextStyle {
  fontSize: number
  color: string
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  background: string | null  // null = no box behind the text
  backgroundOpacity: number
  anchor: TextAnchor
  angle: number  // degrees, clockwise on screen
}

export interface TextAnnotation extends TextStyle {
  id: string
  embeddingName: string
  // The two .obsm columns in view when it was placed (a note on PC1/PC2 means
  // nothing on PC2/PC3), as drawn lines record them.
  dimX: number
  dimY: number
  x: number
  y: number
  text: string
  visible: boolean
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontSize: 14,
  color: '#ffffff',
  fontWeight: 'normal',
  fontStyle: 'normal',
  background: null,
  backgroundOpacity: 0.6,
  anchor: 'middle',
  angle: 0,
}

export const TEXT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'

export function makeTextAnnotation(
  at: { embeddingName: string; dimX: number; dimY: number; x: number; y: number; text: string },
  style: TextStyle,
  id: string,
  overrides: Partial<TextAnnotation> = {},
): TextAnnotation {
  return { ...style, ...at, id, visible: true, ...overrides }
}

export function newTextAnnotationId(): string {
  return `text_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/** The style part of a note, to seed the next one with. */
export function styleOf(t: TextAnnotation): TextStyle {
  const { fontSize, color, fontWeight, fontStyle, background, backgroundOpacity, anchor, angle } = t
  return { fontSize, color, fontWeight, fontStyle, background, backgroundOpacity, anchor, angle }
}

export function annotationsInView(
  notes: TextAnnotation[], embeddingName: string, dimX: number, dimY: number,
): TextAnnotation[] {
  return notes.filter((t) => t.visible && t.embeddingName === embeddingName
    && (t.dimX ?? 0) === dimX && (t.dimY ?? 1) === dimY)
}

/** An in-progress rigid transform of the cells: the notes inside ``hull``
 * (every note when it is null, as for a whole-embedding rotate) are drawn
 * at their transformed anchor until the drag commits. */
export interface AnnotationPreview {
  affine: ShapeAffine
  hull: Pt[] | null
}

export function previewAnnotations(notes: TextAnnotation[], preview: AnnotationPreview | null): TextAnnotation[] {
  if (!preview) return notes
  return notes.map((t) => {
    if (preview.hull && !pointInPolygon(t.x, t.y, preview.hull)) return t
    const [x, y] = transformPoint([t.x, t.y], preview.affine)
    return { ...t, x, y }
  })
}

/** The same orthographic mapping ScatterPlot's screenToData/dataToScreen use. */
export function viewTransform(target: [number, number], zoom: number, width: number, height: number) {
  const scale = Math.pow(2, zoom)
  return {
    toScreen: (x: number, y: number): [number, number] =>
      [(x - target[0]) * scale + width / 2, (y - target[1]) * scale + height / 2],
    toData: (sx: number, sy: number): [number, number] =>
      [(sx - width / 2) / scale + target[0], (sy - height / 2) / scale + target[1]],
  }
}

export interface TextBlockLayout {
  lines: string[]
  lineHeight: number
  width: number
  height: number
  firstLineY: number  // y of the first line's middle, relative to the anchor point
  boxX: number
  boxY: number
  boxW: number
  boxH: number
}

/** Where the lines and the background box go, relative to the anchor point
 * (before rotation). The block is centred vertically on the point; the
 * anchor decides which horizontal edge sits on it. */
export function textBlockLayout(
  text: string, fontSize: number, anchor: TextAnchor, measure: (line: string) => number,
): TextBlockLayout {
  const lines = text.split('\n')
  const lineHeight = fontSize * 1.2
  const width = Math.max(0, ...lines.map(measure))
  const height = lines.length * lineHeight
  const padX = fontSize * 0.4
  const padY = fontSize * 0.2
  const left = anchor === 'start' ? 0 : anchor === 'middle' ? -width / 2 : -width
  return {
    lines,
    lineHeight,
    width,
    height,
    firstLineY: -((lines.length - 1) * lineHeight) / 2,
    boxX: left - padX,
    boxY: -height / 2 - padY,
    boxW: width + 2 * padX,
    boxH: height + 2 * padY,
  }
}

export function backgroundRgba(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  const [r, g, b] = m ? [1, 2, 3].map((i) => parseInt(m[i], 16)) : [0, 0, 0]
  const a = Math.min(1, Math.max(0, opacity))
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** Top-left of the editor popover: below-right of the point, flipped when it
 * would leave the plot, and never outside it. */
export function clampEditorPosition(
  px: number, py: number, w: number, h: number, boxW: number, boxH: number,
): { left: number; top: number } {
  const gap = 12
  let left = px + gap + w <= boxW ? px + gap : px - gap - w
  let top = py + gap + h <= boxH ? py + gap : py - gap - h
  left = Math.max(0, Math.min(left, boxW - w))
  top = Math.max(0, Math.min(top, boxH - h))
  return { left, top }
}
