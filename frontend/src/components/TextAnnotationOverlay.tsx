import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore, DatasetSlot } from '../store'
import {
  TEXT_FONT_FAMILY,
  annotationsInView,
  backgroundRgba,
  clampEditorPosition,
  makeTextAnnotation,
  newTextAnnotationId,
  previewAnnotations,
  styleOf,
  textBlockLayout,
  viewTransform,
  type AnnotationPreview,
  type TextAnchor,
  type TextAnnotation,
  type TextStyle,
} from '../lib/textAnnotations'

// Text annotations on a 2D embedding. Drawn on every plot; interactive only in
// Add → Text mode, when this layer takes the pointer: a click on empty plot
// places a new note, a click on a note opens it for editing, a drag moves it.

const EDITOR_W = 272
const EDITOR_H = 206
const DRAG_THRESHOLD_PX = 3
// One stable empty list, so the store selector never returns a fresh array.
const NO_NOTES: TextAnnotation[] = []

let measureCtx: CanvasRenderingContext2D | null = null
function measureLine(line: string, style: TextStyle): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return line.length * style.fontSize * 0.6
  measureCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${TEXT_FONT_FAMILY}`
  return measureCtx.measureText(line).width
}

interface Props {
  slot?: DatasetSlot
  embeddingName: string
  dimX: number
  dimY: number
  target: [number, number]
  zoom: number
  active: boolean
  /** A rigid transform in progress on the cells (quilt drag, rotate): the
   *  notes it covers are drawn where they will land. */
  preview?: AnnotationPreview | null
}

interface Pending {
  x: number
  y: number
  text: string
  style: TextStyle
}

export default function TextAnnotationOverlay({ slot, embeddingName, dimX, dimY, target, zoom, active, preview = null }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const resolvedSlot = useStore((s) => slot ?? s.activeSlot)
  const notes = useStore((s) => (slot ? s.datasets[slot]?.textAnnotations : s.textAnnotations) ?? NO_NOTES)
  const activeTextId = useStore((s) => s.activeTextId)
  const textStyleDefaults = useStore((s) => s.textStyleDefaults)
  const upsert = useStore((s) => s.upsertTextAnnotation)
  const remove = useStore((s) => s.removeTextAnnotation)
  const setActiveTextId = useStore((s) => s.setActiveTextId)
  const setTextStyleDefaults = useStore((s) => s.setTextStyleDefaults)

  const [pending, setPending] = useState<Pending | null>(null)
  // The open note as it was when the editor opened, so Escape can undo.
  const editSnapshot = useRef<TextAnnotation | null>(null)

  const view = useMemo(() => viewTransform(target, zoom, size.w, size.h), [target, zoom, size.w, size.h])
  const shown = useMemo(
    () => previewAnnotations(annotationsInView(notes, embeddingName, dimX, dimY), preview),
    [notes, embeddingName, dimX, dimY, preview])
  const editing = active ? shown.find((t) => t.id === activeTextId) ?? null : null

  const closeEditor = useCallback(() => {
    if (editing) {
      if (!editing.text.trim()) remove(resolvedSlot, editing.id)
      else setTextStyleDefaults(styleOf(editing))
      setActiveTextId(null)
    }
    editSnapshot.current = null
  }, [editing, remove, resolvedSlot, setActiveTextId, setTextStyleDefaults])

  const commitPending = useCallback(() => {
    if (pending && pending.text.trim()) {
      upsert(resolvedSlot, makeTextAnnotation(
        { embeddingName, dimX, dimY, x: pending.x, y: pending.y, text: pending.text },
        pending.style, newTextAnnotationId()))
      setTextStyleDefaults(pending.style)
    }
    setPending(null)
  }, [pending, upsert, resolvedSlot, embeddingName, dimX, dimY, setTextStyleDefaults])

  // Leaving Text mode drops an unfinished note and closes the editor.
  useEffect(() => {
    if (active) return
    setPending(null)
    editSnapshot.current = null
    const open = useStore.getState().activeTextId
    if (open && notes.some((t) => t.id === open)) setActiveTextId(null)
  }, [active, notes, setActiveTextId])

  // Delete / Backspace removes the open note when focus is not in a field.
  useEffect(() => {
    if (!active || !editing) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        remove(resolvedSlot, editing.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, editing, remove, resolvedSlot])

  const localPoint = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }

  // A click on empty plot: finish whatever is open, or start a new note.
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if (!active) return
    if (pending || editing) {
      commitPending()
      closeEditor()
      return
    }
    const [sx, sy] = localPoint(e)
    const [x, y] = view.toData(sx, sy)
    setPending({ x, y, text: '', style: textStyleDefaults })
  }

  // Press on a note: drag it if the pointer moves, otherwise open it.
  const handleNoteMouseDown = (e: React.MouseEvent, note: TextAnnotation) => {
    if (!active) return
    e.stopPropagation()
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY }
    const [ox, oy] = view.toScreen(note.x, note.y)
    let dragged = false
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      dragged = true
      const [x, y] = view.toData(ox + dx, oy + dy)
      const current = useStore.getState().datasets[resolvedSlot]?.textAnnotations.find((t) => t.id === note.id)
      if (current) upsert(resolvedSlot, { ...current, x, y })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (dragged) return
      commitPending()
      if (editing && editing.id !== note.id) closeEditor()
      editSnapshot.current = note
      setActiveTextId(note.id)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const renderNote = (key: string, note: Pick<TextAnnotation, 'x' | 'y' | 'text'> & TextStyle,
    opts: { selected: boolean; onMouseDown?: (e: React.MouseEvent) => void }) => {
    const [sx, sy] = view.toScreen(note.x, note.y)
    const shownText = note.text || ' '
    const layout = textBlockLayout(shownText, note.fontSize, note.anchor, (l) => measureLine(l, note))
    const minW = opts.selected ? Math.max(layout.boxW, note.fontSize) : layout.boxW
    return (
      <g
        key={key}
        transform={`translate(${sx},${sy}) rotate(${note.angle})`}
        style={{ cursor: active ? 'move' : 'default', pointerEvents: active ? 'all' : 'none' }}
        onMouseDown={opts.onMouseDown}
        onClick={(e) => e.stopPropagation()}
        data-text-annotation={key}
      >
        {/* Hit area and optional background box */}
        <rect
          x={layout.boxX}
          y={layout.boxY}
          width={minW}
          height={layout.boxH}
          rx={3}
          fill={note.background ? backgroundRgba(note.background, note.backgroundOpacity) : 'transparent'}
          stroke={opts.selected ? '#4ecdc4' : 'none'}
          strokeDasharray={opts.selected ? '4 3' : undefined}
          strokeWidth={1}
        />
        <text
          x={0}
          y={layout.firstLineY}
          textAnchor={note.anchor}
          dominantBaseline="middle"
          fill={note.color}
          fontSize={note.fontSize}
          fontWeight={note.fontWeight}
          fontStyle={note.fontStyle}
          fontFamily={TEXT_FONT_FAMILY}
          style={{ userSelect: 'none' }}
        >
          {layout.lines.map((line, i) => (
            <tspan key={i} x={0} dy={i === 0 ? 0 : layout.lineHeight}>{line || ' '}</tspan>
          ))}
        </text>
      </g>
    )
  }

  const editorAnchor = pending ? view.toScreen(pending.x, pending.y)
    : editing ? view.toScreen(editing.x, editing.y) : null
  const editorPos = editorAnchor
    ? clampEditorPosition(editorAnchor[0], editorAnchor[1], EDITOR_W, EDITOR_H, size.w, size.h)
    : null

  return (
    <div
      ref={ref}
      onClick={handleBackgroundClick}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 6,
        pointerEvents: active ? 'auto' : 'none',
        cursor: active ? 'text' : 'default',
      }}
    >
      {size.w > 0 && (
        <svg width={size.w} height={size.h} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
          {shown.map((note) => renderNote(note.id, note, {
            selected: note.id === editing?.id,
            onMouseDown: (e) => handleNoteMouseDown(e, note),
          }))}
          {pending && renderNote('__pending__', { ...pending.style, x: pending.x, y: pending.y, text: pending.text },
            { selected: true })}
        </svg>
      )}

      {active && !editorPos && (
        <div style={styles.hint}>
          Text: click to place a label · click a label to edit · drag to move
        </div>
      )}

      {editorPos && pending && (
        <TextEditorCard
          left={editorPos.left}
          top={editorPos.top}
          text={pending.text}
          style={pending.style}
          isNew
          onText={(text) => setPending({ ...pending, text })}
          onStyle={(patch) => setPending({ ...pending, style: { ...pending.style, ...patch } })}
          onDone={commitPending}
          onCancel={() => setPending(null)}
        />
      )}
      {editorPos && !pending && editing && (
        <TextEditorCard
          left={editorPos.left}
          top={editorPos.top}
          text={editing.text}
          style={styleOf(editing)}
          isNew={false}
          onText={(text) => upsert(resolvedSlot, { ...editing, text })}
          onStyle={(patch) => upsert(resolvedSlot, { ...editing, ...patch })}
          onDone={closeEditor}
          onCancel={() => {
            if (editSnapshot.current) upsert(resolvedSlot, editSnapshot.current)
            editSnapshot.current = null
            setActiveTextId(null)
          }}
          onDelete={() => remove(resolvedSlot, editing.id)}
        />
      )}
    </div>
  )
}

interface EditorProps {
  left: number
  top: number
  text: string
  style: TextStyle
  isNew: boolean
  onText: (text: string) => void
  onStyle: (patch: Partial<TextStyle>) => void
  onDone: () => void
  onCancel: () => void
  onDelete?: () => void
}

function TextEditorCard({ left, top, text, style, isNew, onText, onStyle, onDone, onCancel, onDelete }: EditorProps) {
  const anchors: [TextAnchor, string, string][] = [
    ['start', '⇤', 'Left-aligned: the text starts at the point'],
    ['middle', '↔', 'Centred on the point'],
    ['end', '⇥', 'Right-aligned: the text ends at the point'],
  ]
  return (
    <div
      role="dialog"
      aria-label={isNew ? 'New text annotation' : 'Edit text annotation'}
      style={{ ...styles.card, left, top, width: EDITOR_W }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // Keys typed here are the editor's: Escape and Delete must not reach the
      // app's mode and selection shortcuts.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <textarea
        autoFocus
        value={text}
        rows={2}
        placeholder="Label text (Shift+Enter for a new line)"
        onChange={(e) => onText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onDone() }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        style={styles.textarea}
      />
      <div style={styles.row}>
        <label style={styles.label} title="Font size in screen pixels">Size</label>
        <input
          type="number"
          min={6}
          max={96}
          value={style.fontSize}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) onStyle({ fontSize: Math.min(96, Math.max(6, v)) })
          }}
          style={{ ...styles.field, width: 48 }}
        />
        <label style={styles.label}>Color</label>
        <input type="color" value={style.color} onChange={(e) => onStyle({ color: e.target.value })} style={styles.swatch} />
        <button
          type="button"
          title="Bold"
          onClick={() => onStyle({ fontWeight: style.fontWeight === 'bold' ? 'normal' : 'bold' })}
          style={{ ...styles.toggle, fontWeight: 'bold', ...(style.fontWeight === 'bold' ? styles.toggleOn : {}) }}
        >B</button>
        <button
          type="button"
          title="Italic"
          onClick={() => onStyle({ fontStyle: style.fontStyle === 'italic' ? 'normal' : 'italic' })}
          style={{ ...styles.toggle, fontStyle: 'italic', ...(style.fontStyle === 'italic' ? styles.toggleOn : {}) }}
        >I</button>
      </div>
      <div style={styles.row}>
        <label style={styles.label}>Align</label>
        {anchors.map(([a, icon, tip]) => (
          <button
            key={a}
            type="button"
            title={tip}
            onClick={() => onStyle({ anchor: a })}
            style={{ ...styles.toggle, ...(style.anchor === a ? styles.toggleOn : {}) }}
          >{icon}</button>
        ))}
        <label style={styles.label} title="Rotation in degrees, clockwise">Rotate</label>
        <input
          type="number"
          min={-180}
          max={180}
          step={5}
          value={style.angle}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (Number.isFinite(v)) onStyle({ angle: Math.min(180, Math.max(-180, v)) })
          }}
          style={{ ...styles.field, width: 52 }}
        />
      </div>
      <div style={styles.row}>
        <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={style.background !== null}
            onChange={(e) => onStyle({ background: e.target.checked ? '#000000' : null })}
          />
          Box
        </label>
        <input
          type="color"
          disabled={style.background === null}
          value={style.background ?? '#000000'}
          onChange={(e) => onStyle({ background: e.target.value })}
          style={{ ...styles.swatch, opacity: style.background === null ? 0.4 : 1 }}
        />
        <label style={styles.label} title="Box opacity">Opacity</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          disabled={style.background === null}
          value={style.backgroundOpacity}
          onChange={(e) => onStyle({ backgroundOpacity: Number(e.target.value) })}
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      <div style={{ ...styles.row, justifyContent: 'space-between', marginTop: 6 }}>
        {onDelete
          ? <button type="button" onClick={onDelete} style={styles.deleteButton}>Delete</button>
          : <span />}
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={onCancel} style={styles.secondaryButton}>{isNew ? 'Cancel' : 'Revert'}</button>
          <button type="button" onClick={onDone} style={styles.primaryButton}>{isNew ? 'Add' : 'Done'}</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  hint: {
    position: 'absolute',
    top: 10,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '6px 12px',
    backgroundColor: 'rgba(78, 205, 196, 0.9)',
    color: 'white',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
  },
  card: {
    position: 'absolute',
    boxSizing: 'border-box',
    backgroundColor: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: 6,
    padding: 8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    cursor: 'default',
    zIndex: 7,
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
    backgroundColor: '#0f1625',
    color: '#eee',
    border: '1px solid #0f3460',
    borderRadius: 4,
    padding: '4px 6px',
    fontSize: 13,
    fontFamily: TEXT_FONT_FAMILY,
  },
  row: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 },
  label: { fontSize: 11, color: '#aaa' },
  field: {
    backgroundColor: '#0f3460',
    color: '#eee',
    border: '1px solid #1a1a2e',
    borderRadius: 3,
    padding: '2px 4px',
    fontSize: 12,
  },
  swatch: { width: 26, height: 22, padding: 0, border: '1px solid #0f3460', borderRadius: 3, background: 'none', cursor: 'pointer' },
  toggle: {
    minWidth: 24,
    height: 22,
    padding: '0 5px',
    backgroundColor: '#0f3460',
    color: '#aaa',
    border: '1px solid #1a1a2e',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 12,
  },
  toggleOn: { backgroundColor: '#4ecdc4', color: '#000' },
  primaryButton: {
    padding: '4px 12px', backgroundColor: '#4ecdc4', color: '#000', border: 'none',
    borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
  },
  secondaryButton: {
    padding: '4px 10px', backgroundColor: 'transparent', color: '#aaa', border: '1px solid #0f3460',
    borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
  deleteButton: {
    padding: '4px 10px', backgroundColor: 'transparent', color: '#e94560', border: '1px solid #e94560',
    borderRadius: 4, cursor: 'pointer', fontSize: 12,
  },
}
