import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useStore } from '../store'
import {
  convertObsColumn,
  deleteObsColumns,
  duplicateObsColumn,
  exportAnnotations,
  fetchObsColumns,
  refreshCellSubsets,
  refreshSchema,
  renameObsColumn,
} from '../hooks/useData'
import ConfirmDialog from './ConfirmDialog'
import {
  OBS_KINDS,
  clickSelection,
  convertTargets,
  countByKind,
  defaultTrueValue,
  filterColumns,
  formatPreview,
  newNameProblem,
  pruneSelection,
  sortColumns,
  toggleAllVisible,
  visibleTickState,
  type ObsColumnInfo,
  type ObsConvertTarget,
  type ObsKind,
  type ObsSort,
  type ObsSortKey,
} from '../lib/obsManager'

const KIND_COLOR: Record<ObsKind, string> = {
  categorical: '#4ecdc4', boolean: '#c39bd3', integer: '#e9a23b',
  float: '#f0c674', string: '#8fb3ff', other: '#888',
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  card: {
    backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '8px',
    width: 'min(1040px, 95vw)', height: 'min(720px, 90vh)', display: 'flex', flexDirection: 'column',
    color: '#eee', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #0f3460',
  },
  title: { fontSize: '15px', fontWeight: 600, color: '#e94560' },
  close: { background: 'none', border: 'none', color: '#aaa', fontSize: '20px', cursor: 'pointer' },
  toolbar: {
    display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center',
    padding: '8px 16px', borderBottom: '1px solid #0f3460',
  },
  input: {
    padding: '5px 8px', fontSize: '12px', backgroundColor: '#0f1625', color: '#eee',
    border: '1px solid #0f3460', borderRadius: '4px',
  },
  chip: {
    padding: '3px 8px', fontSize: '11px', borderRadius: '10px', cursor: 'pointer',
    border: '1px solid #0f3460', background: 'transparent', color: '#aaa',
  },
  button: {
    padding: '5px 10px', fontSize: '12px', borderRadius: '4px', cursor: 'pointer',
    border: '1px solid #0f3460', backgroundColor: '#0f3460', color: '#eee',
  },
  danger: { backgroundColor: '#e94560', borderColor: '#e94560', color: '#fff', fontWeight: 600 },
  tableWrap: { flex: 1, overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  th: {
    position: 'sticky', top: 0, backgroundColor: '#0f1625', color: '#aaa', fontWeight: 600,
    textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #0f3460', whiteSpace: 'nowrap',
    userSelect: 'none', zIndex: 1,
  },
  td: { padding: '4px 8px', borderBottom: '1px solid #1b2a4a', verticalAlign: 'middle' },
  badge: {
    display: 'inline-block', marginLeft: '6px', padding: '0 5px', fontSize: '10px',
    borderRadius: '3px', border: '1px solid #0f3460', color: '#aaa', whiteSpace: 'nowrap',
  },
  edit: {
    borderTop: '1px solid #0f3460', padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: '8px',
    backgroundColor: '#121c36',
  },
  editRow: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px' },
  label: { width: '74px', color: '#aaa' },
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** The .obs manager: every cell-metadata column with its type, counts and a
 *  preview, multi-select delete and export, and per-column rename, duplicate
 *  and type conversion. Mounted by the Cells panel only while open, so its
 *  state starts fresh each time. */
export default function ObsManagerModal({ onClose }: { onClose: () => void }) {
  const activeSlot = useStore((s) => s.activeSlot)
  const colorColumn = useStore((s) => s.selectedColorColumn)
  const forgetObsColumn = useStore((s) => s.forgetObsColumn)
  const refreshObsSummaries = useStore((s) => s.refreshObsSummaries)

  const [columns, setColumns] = useState<ObsColumnInfo[] | null>(null)
  const [nCells, setNCells] = useState(0)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<Set<ObsKind>>(new Set())
  const [sort, setSort] = useState<ObsSort>({ key: 'order', dir: 'asc' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [renameDraft, setRenameDraft] = useState('')
  const [dupDraft, setDupDraft] = useState('')
  const [convertTo, setConvertTo] = useState<ObsConvertTarget | ''>('')
  const [trueValue, setTrueValue] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const out = await fetchObsColumns()
      setColumns(out.columns)
      setNCells(out.n_cells)
      setLoadError(null)
      const names = out.columns.map((c) => c.name)
      setSelected((s) => pruneSelection(s, names))
      setFocus((f) => (f !== null && names.includes(f) ? f : null))
    } catch (err) {
      setLoadError((err as Error).message)
    }
  }, [])

  // Reload when the active dataset changes under the open modal.
  useEffect(() => { load() }, [load, activeSlot])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = useMemo(
    () => sortColumns(filterColumns(columns ?? [], query, kinds), sort),
    [columns, query, kinds, sort],
  )
  const shownNames = useMemo(() => shown.map((c) => c.name), [shown])
  const kindCounts = useMemo(() => countByKind(columns ?? []), [columns])
  const tick = visibleTickState(selected, shownNames)
  const byName = useMemo(() => new Map((columns ?? []).map((c) => [c.name, c])), [columns])
  // Selected names in .obs order, for the dialog and the export.
  const selectedInOrder = useMemo(
    () => (columns ?? []).map((c) => c.name).filter((n) => selected.has(n)),
    [columns, selected],
  )
  const focused = focus !== null ? byName.get(focus) ?? null : null
  const targets = focused ? convertTargets(focused) : []
  const boolValues = focused && 'top' in focused.preview ? focused.preview.top.map((t) => t.value) : []

  // Reset the edit drafts whenever a different column takes the focus.
  useEffect(() => {
    setRenameDraft(focused?.name ?? '')
    setDupDraft(focused ? `${focused.name}_copy` : '')
    setConvertTo('')
    setActionError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])
  useEffect(() => {
    setTrueValue(convertTo === 'boolean' ? defaultTrueValue(boolValues) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertTo, focus])

  /** After any mutation: both refresh channels, then this table. */
  const afterMutation = useCallback(async () => {
    await refreshSchema()
    refreshObsSummaries()
    await load()
  }, [load, refreshObsSummaries])

  const run = useCallback(async (fn: () => Promise<string>) => {
    setBusy(true)
    setActionError(null)
    setStatus(null)
    try {
      setStatus(await fn())
      await afterMutation()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [afterMutation])

  const handleDelete = useCallback(async () => {
    const cols = selectedInOrder
    setBusy(true)
    setActionError(null)
    try {
      const out = await deleteObsColumns(cols)
      // Colour-by, label overlay, hidden/display-name state: the same reset the
      // Cells panel's single delete does.
      out.deleted.forEach((c) => forgetObsColumn(c))
      setConfirmDelete(false)
      setSelected(new Set())
      setAnchor(null)
      setStatus(`Deleted ${plural(out.deleted.length, 'column')}.`)
      await afterMutation()
      if (out.subsets_removed.length) await refreshCellSubsets()
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [selectedInOrder, forgetObsColumn, afterMutation])

  const handleExport = useCallback(async () => {
    try {
      const tsv = await exportAnnotations(selectedInOrder)
      const url = URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'obs_columns.tsv'
      a.click()
      URL.revokeObjectURL(url)
      setStatus(`Exported ${plural(selectedInOrder.length, 'column')}.`)
    } catch (err) {
      setActionError((err as Error).message)
    }
  }, [selectedInOrder])

  const handleRename = () => focused && run(async () => {
    const old = focused.name
    const out = await renameObsColumn(old, renameDraft.trim())
    if (selected.has(old)) {
      setSelected((s) => { const n = new Set(s); n.delete(old); n.add(out.new_name); return n })
    }
    // forgetObsColumn clears colour-by, the label overlay and display names
    // for the old name; colour-by then follows the column to its new name
    // (colorBy is null, so the colour hook refetches).
    forgetObsColumn(old)
    if (colorColumn === old) useStore.getState().setSelectedColorColumn(out.new_name)
    setFocus(out.new_name)
    return `Renamed '${old}' to '${out.new_name}'.`
  })

  const handleDuplicate = () => focused && run(async () => {
    const out = await duplicateObsColumn(focused.name, dupDraft.trim())
    return `Copied '${focused.name}' to '${out.new_name}'.`
  })

  const handleConvert = () => focused && convertTo && run(async () => {
    const out = await convertObsColumn(focused.name, convertTo, convertTo === 'boolean' ? trueValue : null)
    // The column's values changed shape; drop the cached colour data so the
    // colour-by hook refetches it.
    if (colorColumn === focused.name) useStore.getState().setColorBy(null)
    return `Converted '${focused.name}' to ${out.kind} (${out.dtype}).`
  })

  const names = (columns ?? []).map((c) => c.name)
  const renameProblem = focused
    ? (renameDraft.trim() === focused.name ? 'unchanged' : newNameProblem(renameDraft, names))
    : null
  const dupProblem = focused ? newNameProblem(dupDraft, names) : null
  const subsetLosses = selectedInOrder.map((n) => byName.get(n)).filter((c) => c?.subset) as ObsColumnInfo[]

  const sortHeader = (key: ObsSortKey, label: string) => (
    <th
      style={{ ...styles.th, cursor: 'pointer', color: sort.key === key ? '#4ecdc4' : '#aaa' }}
      onClick={() => setSort((s) => (s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'n_unique' || key === 'n_missing' ? 'desc' : 'asc' }))}
      title="Sort"
    >
      {label}{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-label=".obs manager">
        <div style={styles.header}>
          <div style={styles.title}>
            .obs columns{' '}
            <span style={{ color: '#888', fontWeight: 400, fontSize: '12px' }}>
              {columns ? `${plural(columns.length, 'column')} · ${plural(nCells, 'cell')}` : ''}
            </span>
          </div>
          <button style={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div style={styles.toolbar}>
          <input
            style={{ ...styles.input, width: '180px' }}
            placeholder="Filter by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-obs-filter
          />
          {OBS_KINDS.filter((k) => kindCounts[k] > 0).map((k) => {
            const on = kinds.has(k)
            return (
              <button
                key={k}
                style={{ ...styles.chip, ...(on ? { borderColor: KIND_COLOR[k], color: KIND_COLOR[k] } : {}) }}
                onClick={() => setKinds((s) => { const n = new Set(s); if (on) n.delete(k); else n.add(k); return n })}
                data-obs-kind-chip={k}
              >
                {k} {kindCounts[k]}
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: '12px', color: '#aaa' }}>{selected.size ? `${selected.size} selected` : ''}</span>
          <button style={{ ...styles.button, ...(selected.size ? {} : { opacity: 0.5 }) }} disabled={!selected.size || busy} onClick={handleExport}
            title="Download the selected columns with cell ids as TSV">
            Export
          </button>
          <button
            style={{ ...styles.button, ...(selected.size ? styles.danger : { opacity: 0.5 }) }}
            disabled={!selected.size || busy}
            onClick={() => { setActionError(null); setConfirmDelete(true) }}
            data-obs-delete
          >
            Delete{selected.size ? ` ${selected.size}` : ''}
          </button>
        </div>

        <div style={styles.tableWrap}>
          {loadError && <div style={{ color: '#e94560', padding: '12px 16px' }}>{loadError}</div>}
          {!columns && !loadError && <div style={{ color: '#888', padding: '12px 16px' }}>Loading…</div>}
          {columns && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={{ ...styles.th, width: '24px' }}>
                    <input
                      type="checkbox"
                      checked={tick === 'all'}
                      ref={(el) => { if (el) el.indeterminate = tick === 'some' }}
                      onChange={() => setSelected((s) => toggleAllVisible(s, shownNames))}
                      title="Select all shown"
                      data-obs-select-all
                    />
                  </th>
                  {sortHeader('name', 'Column')}
                  {sortHeader('kind', 'Type')}
                  {sortHeader('n_unique', 'Unique')}
                  {sortHeader('n_missing', 'Missing')}
                  <th style={styles.th}>Preview <span style={{ fontWeight: 400, color: '#666' }}>(top values · or min · median · max)</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const isSel = selected.has(c.name)
                  const isFocus = focus === c.name
                  return (
                    <tr
                      key={c.name}
                      data-obs-row={c.name}
                      onClick={() => setFocus(c.name)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: isFocus ? '#1f3358' : isSel ? '#182a4a' : undefined,
                      }}
                    >
                      <td style={styles.td} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => { /* handled on click, which carries shiftKey */ }}
                          onClick={(e) => {
                            const r = clickSelection(selected, c.name, { shift: e.shiftKey, anchor, visible: shownNames })
                            setSelected(r.selected)
                            setAnchor(r.anchor)
                          }}
                          data-obs-check={c.name}
                        />
                      </td>
                      <td style={{ ...styles.td, fontFamily: 'monospace', color: '#eee' }}>
                        {c.name}
                        {colorColumn === c.name && (
                          <span style={{ ...styles.badge, color: '#4ecdc4', borderColor: '#4ecdc4' }} title="Current colour-by column">colour-by</span>
                        )}
                        {c.subset && (
                          <span style={{ ...styles.badge, color: '#e9a23b', borderColor: '#e9a23b' }} title="Membership column of a saved cell subset">subset {c.subset}</span>
                        )}
                        {c.prefix_group && !c.subset && <span style={styles.badge}>{c.prefix_group}</span>}
                        {c.has_colors && <span style={styles.badge} title="Has a saved colour palette (uns)">colours</span>}
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <span style={{ color: KIND_COLOR[c.kind] }} data-obs-kind>{c.kind}</span>
                        <span style={{ color: '#666', marginLeft: '6px', fontSize: '11px' }}>{c.dtype}</span>
                      </td>
                      <td style={{ ...styles.td, textAlign: 'right' }}>{c.n_unique === null ? '–' : c.n_unique.toLocaleString()}</td>
                      <td style={{ ...styles.td, textAlign: 'right', color: c.n_missing ? '#e9a23b' : '#666' }}>
                        {c.n_missing.toLocaleString()}
                      </td>
                      <td style={{ ...styles.td, color: '#aaa', maxWidth: '340px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={formatPreview(c)}>
                        {formatPreview(c)}
                      </td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr><td style={{ ...styles.td, color: '#888' }} colSpan={6}>No columns match.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div style={styles.edit}>
          {!focused && (
            <div style={{ fontSize: '12px', color: '#888' }}>
              Tick columns to delete or export them; shift-click ticks a range. Click a row to rename, duplicate or convert it.
            </div>
          )}
          {focused && (
            <>
              <div style={{ fontSize: '12px', color: '#aaa' }}>
                Column <span style={{ fontFamily: 'monospace', color: '#eee' }}>{focused.name}</span>
              </div>
              <div style={styles.editRow}>
                <span style={styles.label}>Rename</span>
                <input
                  style={{ ...styles.input, width: '220px' }}
                  value={renameDraft}
                  disabled={!!focused.subset}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !renameProblem && !busy) handleRename() }}
                  data-obs-rename-input
                />
                <button style={styles.button} disabled={!!renameProblem || !!focused.subset || busy} onClick={handleRename} data-obs-rename>
                  Rename
                </button>
                {focused.subset && (
                  <span style={{ color: '#888' }}>A saved subset's column is named after the subset, so it cannot be renamed.</span>
                )}
                {!focused.subset && renameProblem && renameProblem !== 'unchanged' && (
                  <span style={{ color: '#e9a23b' }}>{renameProblem}</span>
                )}
              </div>
              <div style={styles.editRow}>
                <span style={styles.label}>Duplicate as</span>
                <input
                  style={{ ...styles.input, width: '220px' }}
                  value={dupDraft}
                  onChange={(e) => setDupDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !dupProblem && !busy) handleDuplicate() }}
                />
                <button style={styles.button} disabled={!!dupProblem || busy} onClick={handleDuplicate}>Duplicate</button>
                {dupProblem && dupDraft.trim() && <span style={{ color: '#e9a23b' }}>{dupProblem}</span>}
              </div>
              <div style={styles.editRow}>
                <span style={styles.label}>Convert to</span>
                <select
                  style={styles.input}
                  value={convertTo}
                  disabled={targets.length === 0}
                  onChange={(e) => setConvertTo(e.target.value as ObsConvertTarget | '')}
                  data-obs-convert-select
                >
                  <option value="">{targets.length ? 'choose a type…' : 'no conversions'}</option>
                  {targets.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {convertTo === 'boolean' && (
                  <>
                    <span style={{ color: '#aaa' }}>True =</span>
                    <select style={styles.input} value={trueValue ?? ''} onChange={(e) => setTrueValue(e.target.value)}>
                      {boolValues.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </>
                )}
                <button style={styles.button} disabled={!convertTo || busy} onClick={handleConvert} data-obs-convert>
                  Convert
                </button>
                {focused.subset && <span style={{ color: '#888' }}>A saved subset's column stays boolean.</span>}
              </div>
            </>
          )}
          {(status || (actionError && !confirmDelete)) && (
            <div style={{ fontSize: '12px', color: actionError ? '#e94560' : '#4ecdc4' }} data-obs-status>
              {actionError && !confirmDelete ? actionError : status}
            </div>
          )}
        </div>

        {/* Inside the card: its backdrop click must not bubble to the overlay
            and close the manager along with the dialog. */}
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete ${plural(selectedInOrder.length, 'column')}?`}
          confirmLabel="Delete"
          busy={busy}
          error={confirmDelete ? actionError : null}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        >
          <div style={{ fontFamily: 'monospace', maxHeight: '140px', overflow: 'auto', marginBottom: '8px' }}>
            {selectedInOrder.slice(0, 20).join(', ')}
            {selectedInOrder.length > 20 ? `, … and ${selectedInOrder.length - 20} more` : ''}
          </div>
          {subsetLosses.length > 0 && (
            <div style={{ color: '#e9a23b', marginBottom: '6px' }}>
              {subsetLosses.length === 1 ? 'Saved subset ' : 'Saved subsets '}
              {subsetLosses.map((c) => `'${c.subset}'`).join(', ')}
              {subsetLosses.length === 1 ? ' loses its membership column and will be removed.' : ' lose their membership columns and will be removed.'}
            </div>
          )}
          {colorColumn && selected.has(colorColumn) && (
            <div style={{ marginBottom: '6px' }}>The plot is coloured by '{colorColumn}'; colouring resets.</div>
          )}
          Colour palettes stored with these columns are removed too. The step is recorded in the analysis history.
        </ConfirmDialog>
      </div>
    </div>
  )
}
