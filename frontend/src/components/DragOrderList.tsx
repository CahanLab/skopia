/**
 * A list whose rows the user reorders by dragging (the ⠿ handle or the row),
 * with an optional checkbox per row. Used by the Expression settings for the
 * cell groups, the gene-set row blocks and the marker blocks.
 *
 * Native HTML5 drag and drop: a row is dropped above the row under the
 * pointer, or below it on that row's lower half, so the last slot is
 * reachable. The parent owns the order (`onReorder` gets the new key list).
 */
import { useState, type ReactNode } from 'react'
import { moveItem } from '../lib/heatmapGroups'

export interface DragOrderItem {
  key: string
  label: ReactNode
  /** Omit for a list without checkboxes. */
  checked?: boolean
  title?: string
}

interface Props {
  items: DragOrderItem[]
  onReorder: (keys: string[]) => void
  onToggle?: (key: string) => void
  /** `data-<attr>-group` on each row and `data-<attr>-groups` on the list, for tests and browser checks. */
  attr: string
  maxHeight?: number
}

export default function DragOrderList({ items, onReorder, onToggle, attr, maxHeight = 180 }: Props) {
  const [dragKey, setDragKey] = useState<string | null>(null)
  // The slot the dragged row would land in: before items[dropAt] (items.length = at the end).
  const [dropAt, setDropAt] = useState<number | null>(null)
  const keys = items.map((i) => i.key)

  const finish = () => { setDragKey(null); setDropAt(null) }
  const drop = () => {
    if (dragKey !== null && dropAt !== null) {
      const from = keys.indexOf(dragKey)
      // removing the row first shifts every later slot up by one
      const to = dropAt > from ? dropAt - 1 : dropAt
      if (to !== from) onReorder(moveItem(keys, dragKey, to))
    }
    finish()
  }

  return (
    <div style={{ ...styles.list, maxHeight }} {...{ [`data-${attr}-groups`]: true }} onDragLeave={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null)
    }}>
      {items.map((item, i) => (
        <div
          key={item.key}
          draggable
          title={item.title ?? 'Drag to reorder'}
          onDragStart={(e) => {
            setDragKey(item.key)
            e.dataTransfer.effectAllowed = 'move'
            // Firefox starts a drag only when some data is set
            e.dataTransfer.setData('text/plain', item.key)
          }}
          onDragOver={(e) => {
            if (dragKey === null) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const r = e.currentTarget.getBoundingClientRect()
            setDropAt(e.clientY > r.top + r.height / 2 ? i + 1 : i)
          }}
          onDrop={(e) => { e.preventDefault(); drop() }}
          onDragEnd={finish}
          style={{
            ...styles.row,
            opacity: dragKey === item.key ? 0.4 : 1,
            borderTop: dropAt === i ? '2px solid #4ecdc4' : '2px solid transparent',
            borderBottom: dropAt === items.length && i === items.length - 1 ? '2px solid #4ecdc4' : '2px solid transparent',
          }}
          {...{ [`data-${attr}-group`]: item.key }}
        >
          <span style={styles.handle} aria-hidden>⠿</span>
          {item.checked !== undefined && (
            <input
              type="checkbox" checked={item.checked} draggable={false}
              onChange={() => onToggle?.(item.key)}
              onMouseDown={(e) => e.stopPropagation()}
            />
          )}
          {/* the name toggles too, as the label of the old checkbox list did */}
          <span
            style={{ ...styles.label, cursor: item.checked !== undefined ? 'pointer' : 'grab' }}
            onClick={item.checked !== undefined ? () => onToggle?.(item.key) : undefined}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  list: {
    overflowY: 'auto',
    border: '1px solid #0f3460',
    borderRadius: '4px',
    padding: '2px 0',
    backgroundColor: '#0f1625',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 8px',
    fontSize: '12px',
    color: '#ccc',
    cursor: 'grab',
    userSelect: 'none',
  },
  handle: { color: '#666', fontSize: '12px', lineHeight: 1 },
  label: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
}
