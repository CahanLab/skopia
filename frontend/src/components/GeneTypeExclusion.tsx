import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { appendDataset } from '../hooks/useData'
import {
  EMPTY_SELECTION,
  excludeGenesBody,
  mitoWarning,
  proteinCodingOnly,
  speciesNote,
  summaryLine,
  type GeneTypeCount,
  type GeneTypeSelection,
  type GeneTypeSetCount,
  type GeneTypeSummary,
} from '../lib/geneTypes'

const API_BASE = '/api'
const DEBOUNCE_MS = 300

const dark = {
  box: { marginBottom: '12px', padding: '8px 10px', backgroundColor: '#0f1625', border: '1px solid #0f3460', borderRadius: '4px' } as const,
  head: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' as const, marginBottom: '6px' },
  title: { fontSize: '12px', color: '#4ecdc4', fontWeight: 600 } as const,
  source: { fontSize: '11px', color: '#888' } as const,
  cols: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' } as const,
  colTitle: { fontSize: '11px', color: '#aaa', margin: '2px 0 3px' } as const,
  row: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#ddd', cursor: 'pointer', padding: '1px 0' } as const,
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  n: { color: '#aaa', fontVariantNumeric: 'tabular-nums' as const },
  tag: { fontSize: '10px', color: '#888', border: '1px solid #0f3460', borderRadius: '3px', padding: '0 3px' } as const,
  examples: { fontSize: '10px', color: '#888', marginLeft: '20px' } as const,
  buttons: { display: 'flex', gap: '6px', margin: '8px 0 6px' } as const,
  button: { padding: '3px 8px', fontSize: '11px', backgroundColor: '#0f3460', color: '#ddd', border: '1px solid #0f3460', borderRadius: '3px', cursor: 'pointer' } as const,
  line: { fontSize: '12px', color: '#ddd' } as const,
  warn: { fontSize: '11px', color: '#e9a23b', marginTop: '4px' } as const,
  error: { fontSize: '11px', color: '#e94560', marginTop: '4px' } as const,
  hint: { fontSize: '11px', color: '#888' } as const,
  mark: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' as const, marginTop: '8px', fontSize: '11px', color: '#aaa' },
  input: { padding: '2px 6px', fontSize: '12px', backgroundColor: '#0f3460', color: '#eee', border: '1px solid #0f3460', borderRadius: '3px', width: '130px' } as const,
  select: { padding: '2px 4px', fontSize: '12px', backgroundColor: '#0f3460', color: '#eee', border: '1px solid #0f3460', borderRadius: '3px' } as const,
}

const fmt = (n: number) => n.toLocaleString('en-US')

function sourceText(s: GeneTypeSummary): string {
  if (!s.source || !s.matched) return ''
  if (s.source.kind === 'file') {
    return `${s.source.label} · ${fmt(s.matched.file)} of ${fmt(s.n_genes)} genes annotated`
  }
  const hit = s.matched.ensembl_id + s.matched.symbol
  return `${s.source.label} · ${fmt(hit)} of ${fmt(s.n_genes)} genes matched`
}

function toggle(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter((x) => x !== name) : [...list, name]
}

function examplesTitle(c: GeneTypeCount): string {
  return c.examples.length ? `e.g. ${c.examples.join(', ')}` : ''
}

/**
 * Exclude Genes by GENCODE class and named set, mounted under the names and
 * patterns fields. Counts and the removal total come from
 * `/scanpy/exclude_genes/types`, which builds the same mask Run removes and
 * Mark writes, so the number shown is the number Run takes.
 */
export function GeneTypeExclusion({ selection, onChange, namesText, patternsText, onMarked }: {
  selection: GeneTypeSelection
  onChange: (sel: GeneTypeSelection) => void
  namesText: string
  patternsText: string
  /** After Mark wrote its column: refresh the schema and the .var column lists. */
  onMarked: (result: Record<string, unknown>, request: Record<string, unknown>) => Promise<void> | void
}) {
  const activeSlot = useStore((s) => s.activeSlot)
  const history = useStore((s) => s.scanpyActionHistory)
  const [summary, setSummary] = useState<GeneTypeSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [column, setColumn] = useState('analysis_genes')
  const [overwrite, setOverwrite] = useState(false)
  const [marking, setMarking] = useState(false)
  const [markMessage, setMarkMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const parsed = excludeGenesBody(namesText, patternsText, selection)
  const body = 'error' in parsed
    ? { species: selection.species, gene_names: null, patterns: null, types: null }
    : { species: selection.species, ...parsed }
  const bodyKey = JSON.stringify(body)

  useEffect(() => {
    let stale = false
    setLoading(true)
    const timer = setTimeout(() => {
      fetch(appendDataset(`${API_BASE}/scanpy/exclude_genes/types`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyKey,
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`)
          return data as GeneTypeSummary
        })
        .then((data) => {
          if (stale) return
          setSummary(data)
          setError(null)
        })
        .catch((e: Error) => { if (!stale) setError(e.message) })
        .finally(() => { if (!stale) setLoading(false) })
    }, DEBOUNCE_MS)
    return () => { stale = true; clearTimeout(timer) }
  }, [bodyKey, activeSlot, history])

  const handleMark = async () => {
    if ('error' in parsed) {
      setMarkMessage({ ok: false, text: parsed.error })
      return
    }
    setMarking(true)
    setMarkMessage(null)
    const request = { ...parsed, column: column.trim(), species: selection.species, overwrite }
    try {
      const res = await fetch(appendDataset(`${API_BASE}/scanpy/annotate_gene_types`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `HTTP ${res.status}`)
      setMarkMessage({
        ok: true,
        text: `.var['${data.column}']: ${fmt(data.n_kept)} genes kept, ${fmt(data.n_marked_out)} marked out. `
          + 'Pick it as the gene subset in HVG or PCA.',
      })
      await onMarked(data, request)
    } catch (e) {
      setMarkMessage({ ok: false, text: (e as Error).message })
    } finally {
      setMarking(false)
    }
  }

  if (!summary) {
    return (
      <div style={dark.box}>
        <div style={dark.head}><span style={dark.title}>By gene type</span></div>
        {error ? <div style={dark.error}>{error}</div> : <div style={dark.hint}>{loading ? 'Reading gene types…' : ''}</div>}
      </div>
    )
  }

  if (!summary.species && !summary.source) {
    return (
      <div style={dark.box}>
        <div style={dark.head}>
          <span style={dark.title}>By gene type</span>
          <span style={dark.source}>the gene names do not say which species this is</span>
        </div>
        <label style={dark.mark}>
          Species
          <select
            style={dark.select}
            value={selection.species ?? ''}
            onChange={(e) => onChange({ ...EMPTY_SELECTION, species: e.target.value || null })}
          >
            <option value="">choose…</option>
            {summary.available_species.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {error && <div style={dark.error}>{error}</div>}
      </div>
    )
  }

  const isFile = summary.source?.kind === 'file'
  const warning = mitoWarning(selection)
  const canMark = !marking && column.trim() !== '' && !('error' in parsed)

  const classRow = (c: GeneTypeCount) => (
    <div key={c.name}>
      <label style={dark.row} title={examplesTitle(c)}>
        <input
          type="checkbox"
          checked={selection.classes.includes(c.name)}
          onChange={() => onChange({ ...selection, classes: toggle(selection.classes, c.name) })}
        />
        <span style={dark.name}>{c.name}</span>
        <span style={dark.n}>{fmt(c.n)}</span>
      </label>
      {(c.name === 'unannotated' || c.name === 'exogenous') && c.n > 0 && (
        <div style={dark.examples}>{examplesTitle(c)}</div>
      )}
    </div>
  )

  const setRow = (s: GeneTypeSetCount) => (
    <label
      key={s.name}
      style={dark.row}
      title={[s.description, examplesTitle(s)].filter(Boolean).join('\n')}
    >
      <input
        type="checkbox"
        checked={selection.sets.includes(s.name)}
        onChange={() => onChange({ ...selection, sets: toggle(selection.sets, s.name) })}
      />
      <span style={dark.name}>{s.name}</span>
      {isFile && s.computed_by === 'skopia' && <span style={dark.tag} title="Not a column in this file: computed by skopia from the gene names">computed</span>}
      <span style={dark.n}>{fmt(s.n)}</span>
    </label>
  )

  return (
    <div style={dark.box}>
      <div style={dark.head}>
        <span style={dark.title}>By gene type</span>
        {!isFile && (
          // The guess can be wrong (and is meaningless for names that are not
          // GENCODE symbols), so the table's species is always a choice.
          <select
            style={dark.select}
            value={summary.species ?? ''}
            title="Which species' GENCODE table to match the gene names against"
            onChange={(e) => onChange({ ...EMPTY_SELECTION, species: e.target.value || null })}
          >
            {summary.available_species.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
          </select>
        )}
        <span style={dark.source}>{sourceText(summary)}</span>
      </div>
      {speciesNote(summary) && <div style={{ ...dark.warn, marginTop: 0, marginBottom: '6px' }}>{speciesNote(summary)}</div>}
      <div style={dark.cols}>
        <div>
          <div style={dark.colTitle}>{isFile ? 'Class (this file)' : 'Class (GENCODE biotype)'}</div>
          {summary.classes.map(classRow)}
        </div>
        <div>
          <div style={dark.colTitle}>Named sets (any class)</div>
          {summary.sets.map(setRow)}
        </div>
      </div>
      <div style={dark.buttons}>
        <button style={dark.button} onClick={() => onChange(proteinCodingOnly(summary))}>Protein-coding only</button>
        <button style={dark.button} onClick={() => onChange({ ...EMPTY_SELECTION, species: selection.species })}>Clear</button>
      </div>
      {error
        ? <div style={dark.error}>{error}</div>
        : summary.selection
          ? <div style={{ ...dark.line, opacity: loading ? 0.6 : 1 }}>{summaryLine(summary.selection)}</div>
          : <div style={dark.hint}>Tick classes or sets to remove them along with the names and patterns above.</div>}
      {warning && <div style={dark.warn}>{warning}</div>}
      <div style={dark.mark}>
        <span>Mark instead: write the kept genes to .var as</span>
        <input style={dark.input} value={column} onChange={(e) => setColumn(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          overwrite
        </label>
        <button
          style={{ ...dark.button, opacity: canMark ? 1 : 0.5 }}
          disabled={!canMark}
          title={'error' in parsed ? parsed.error : undefined}
          onClick={handleMark}
        >
          {marking ? 'Marking…' : 'Mark'}
        </button>
      </div>
      {markMessage && <div style={markMessage.ok ? { ...dark.hint, color: '#4ecdc4' } : dark.error}>{markMessage.text}</div>}
    </div>
  )
}
