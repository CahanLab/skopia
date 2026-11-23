import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { createVarColumnFromGenes, refreshSchema, type VarColumnFromGenesResult } from '../hooks/useData'
import { suggestVarColumnName } from '../lib/varColumnName'

const dark = {
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 } as const,
  card: { backgroundColor: '#16213e', border: '1px solid #0f3460', borderRadius: '8px', padding: '18px 20px', width: '420px', maxWidth: 'calc(100vw - 32px)', color: '#eee', fontSize: '13px' } as const,
  title: { margin: '0 0 6px', fontSize: '15px' } as const,
  hint: { fontSize: '11px', color: '#888', lineHeight: 1.45 } as const,
  label: { display: 'block', fontSize: '12px', color: '#aaa', margin: '12px 0 4px' } as const,
  input: { width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '13px', color: '#eee', backgroundColor: '#0f1625', border: '1px solid #0f3460', borderRadius: '4px', fontFamily: 'monospace' } as const,
  check: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#aaa', marginTop: '8px', cursor: 'pointer' } as const,
  row: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' } as const,
  button: { padding: '6px 14px', fontSize: '12px', borderRadius: '4px', border: '1px solid #0f3460', backgroundColor: '#0f3460', color: '#eee', cursor: 'pointer' } as const,
  primary: { padding: '6px 14px', fontSize: '12px', borderRadius: '4px', border: 'none', backgroundColor: '#4ecdc4', color: '#0f1625', fontWeight: 600, cursor: 'pointer' } as const,
}

/**
 * "Save as .var column": a gene set written to the dataset as a boolean .var
 * column, so the file carries it and every gene-subset picker (PCA, markers,
 * NMF, QC vars) can use it. Opened from a gene set's ⋯ menu in the Genes pane
 * and from the Gene Set Manager; the store holds the set (null = closed).
 */
export default function GeneSetToVarColumnModal() {
  const source = useStore((s) => s.geneSetToVarSource)
  const setSource = useStore((s) => s.setGeneSetToVarSource)
  const [name, setName] = useState('')
  const [includeDown, setIncludeDown] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<VarColumnFromGenesResult | null>(null)

  // Fresh form for each set: the modal is mounted for the whole session.
  useEffect(() => {
    if (!source) return
    setName(suggestVarColumnName(source.name))
    setIncludeDown(false)
    setOverwrite(false)
    setError(null)
    setDone(null)
    setBusy(false)
  }, [source])

  useEffect(() => {
    if (!source) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSource(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [source, setSource])

  if (!source) return null
  const down = source.genesDown ?? []
  const genes = includeDown ? [...source.genes, ...down] : source.genes
  const close = () => setSource(null)

  const save = async () => {
    if (!name.trim() || genes.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await createVarColumnFromGenes(name.trim(), genes, overwrite)
      setDone(res)
      // VarColumnsSection and the gene-subset pickers read .var on a schema change.
      await refreshSchema()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={dark.overlay} onClick={close}>
      <div style={dark.card} onClick={(e) => e.stopPropagation()} data-gene-set-to-var>
        <h3 style={dark.title}>Save “{source.name}” as a .var column</h3>
        <div style={dark.hint}>
          A boolean column in the dataset's .var, true for the genes in this set. It is saved with the
          file and appears wherever a .var gene column can be chosen (PCA gene subset, marker genes, QC vars).
        </div>
        {done ? (
          <>
            <div style={{ marginTop: '14px' }} data-gene-set-to-var-result>
              Flagged {done.n_genes_matched.toLocaleString()} of {done.n_genes_listed.toLocaleString()} genes
              in <code>.var['{done.name}']</code>.
            </div>
            {done.missing.length > 0 && (
              <div style={{ ...dark.hint, marginTop: '6px' }}>
                Not in this dataset ({done.missing.length}): {done.missing.slice(0, 12).join(', ')}
                {done.missing.length > 12 ? ', …' : ''}
              </div>
            )}
            <div style={dark.row}>
              <button style={dark.primary} onClick={close}>Done</button>
            </div>
          </>
        ) : (
          <>
            <label style={dark.label}>Column name</label>
            <input
              autoFocus
              style={dark.input}
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') save() }}
            />
            {down.length > 0 && (
              <label style={dark.check}>
                <input type="checkbox" checked={includeDown} onChange={(e) => setIncludeDown(e.target.checked)} />
                Include the {down.length} ↓ genes too (otherwise only the {source.genes.length} ↑ genes)
              </label>
            )}
            <label style={dark.check}>
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Replace a boolean column of this name if one exists
            </label>
            {error && <div style={{ color: '#e94560', fontSize: '12px', marginTop: '10px' }}>{error}</div>}
            <div style={dark.row}>
              <span style={{ ...dark.hint, marginRight: 'auto', alignSelf: 'center' }}>{genes.length.toLocaleString()} genes</span>
              <button style={dark.button} onClick={close}>Cancel</button>
              <button
                style={{ ...dark.primary, opacity: !name.trim() || busy ? 0.5 : 1 }}
                disabled={!name.trim() || busy}
                onClick={save}
              >
                {busy ? 'Saving…' : 'Save column'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
