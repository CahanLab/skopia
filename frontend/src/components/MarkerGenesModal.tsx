import { useState, useCallback, useEffect, useRef } from 'react'
import { markerGenesParams, maskedCategoryCounts, runnableGroupCount, selectionFromModal, runSignature } from '../lib/markerGenes'
import { indicesFromMask } from '../lib/cellSubsets'
import { DEFAULT_DOTPLOT_OPTIONS, type MarkerRestriction } from '../lib/markerSelection'
import RestrictionPicker from './RestrictionPicker'
import { useStore, cfgDefault, ObsColumnData } from '../store'
import { useObsSummaries, runMarkerGenes, selectMarkerGenes, MarkerGenesGroupResult, appendDataset } from '../hooks/useData'

const styles = {
  backdrop: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: '8px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    width: '560px',
    maxWidth: '90vw',
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    padding: '16px 20px',
    borderBottom: '1px solid #0f3460',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#e94560',
    margin: 0,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#aaa',
    fontSize: '20px',
    cursor: 'pointer',
    padding: '4px 8px',
    lineHeight: 1,
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px 20px',
  },
  label: {
    fontSize: '12px',
    color: '#aaa',
    marginBottom: '6px',
    display: 'block',
    fontWeight: 500,
  },
  columnName: {
    fontSize: '14px',
    color: '#eee',
    fontWeight: 600,
    marginBottom: '16px',
  },
  groupList: {
    maxHeight: '200px',
    overflowY: 'auto' as const,
    backgroundColor: '#0a0f1a',
    borderRadius: '4px',
    padding: '8px',
    marginBottom: '16px',
  },
  groupItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    fontSize: '13px',
    color: '#ccc',
    cursor: 'pointer',
    borderRadius: '4px',
    marginBottom: '2px',
  },
  groupItemHover: {
    backgroundColor: '#0f3460',
  },
  checkbox: {
    marginRight: '8px',
    cursor: 'pointer',
  },
  groupCount: {
    color: '#666',
    fontSize: '11px',
    marginLeft: 'auto',
  },
  selectAll: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    fontSize: '12px',
    color: '#888',
    cursor: 'pointer',
    borderBottom: '1px solid #1a1a2e',
    marginBottom: '4px',
    paddingBottom: '8px',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
  },
  input: {
    padding: '6px 10px',
    fontSize: '13px',
    backgroundColor: '#0f3460',
    color: '#eee',
    border: '1px solid #1a1a2e',
    borderRadius: '4px',
    outline: 'none',
    width: '80px',
  },
  advancedToggle: {
    fontSize: '12px',
    color: '#888',
    cursor: 'pointer',
    userSelect: 'none' as const,
    marginBottom: '12px',
  },
  advancedContent: {
    backgroundColor: '#0a0f1a',
    borderRadius: '4px',
    padding: '12px',
    marginBottom: '16px',
  },
  footer: {
    padding: '12px 20px',
    borderTop: '1px solid #0f3460',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  button: {
    padding: '8px 16px',
    fontSize: '13px',
    borderRadius: '4px',
    cursor: 'pointer',
    border: 'none',
  },
  primaryButton: {
    backgroundColor: '#e94560',
    color: '#fff',
  },
  secondaryButton: {
    backgroundColor: '#0f3460',
    color: '#aaa',
    border: '1px solid #1a1a2e',
  },
  successButton: {
    backgroundColor: '#4ecdc4',
    color: '#000',
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  resultsSummary: {
    marginBottom: '12px',
    fontSize: '13px',
    color: '#aaa',
  },
  resultGroup: {
    backgroundColor: '#0a0f1a',
    borderRadius: '4px',
    marginBottom: '8px',
    overflow: 'hidden',
  },
  resultGroupHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#eee',
    fontWeight: 500,
  },
  resultGeneList: {
    padding: '4px 12px 8px',
    borderTop: '1px solid #1a1a2e',
  },
  resultGene: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '3px 0',
    fontSize: '12px',
    color: '#bbb',
  },
  resultGeneStats: {
    fontSize: '11px',
    color: '#666',
  },
  scopeNote: {
    fontSize: '11px',
    color: '#e9a23b',
    padding: '6px 8px',
    border: '1px solid #0f3460',
    borderRadius: '4px',
    marginBottom: '12px',
  },
  error: {
    fontSize: '12px',
    color: '#e94560',
    padding: '8px 12px',
    backgroundColor: 'rgba(233, 69, 96, 0.1)',
    borderRadius: '4px',
    marginBottom: '12px',
  },
}

export default function MarkerGenesModal() {
  const {
    isMarkerGenesModalOpen,
    markerGenesColumn,
    setMarkerGenesModalOpen,
    addFolderToCategory,
    comparisonCheckedColumn,
    comparisonCheckedCategories,
    activeSlot,
    setEnrichmentSource,
    activeCellMask,
    activeSubsetName,
    setHeatmapConfig,
    setCenterPanelView,
  } = useStore()

  const { summaries } = useObsSummaries()

  // Config state
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set())
  const [topN, setTopN] = useState(() => cfgDefault(['marker_genes', 'top_n'], 100))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [minInGroupFraction, setMinInGroupFraction] = useState(() => String(cfgDefault(['marker_genes', 'min_in_group_fraction'], '')))
  const [maxOutGroupFraction, setMaxOutGroupFraction] = useState(() => String(cfgDefault(['marker_genes', 'max_out_group_fraction'], '')))
  const [minFoldChange, setMinFoldChange] = useState(() => String(cfgDefault(['marker_genes', 'min_fold_change'], '')))

  // Gene subset state
  const [booleanColumns, setBooleanColumns] = useState<{ name: string; n_true: number; n_total: number }[]>([])
  const [geneSubset, setGeneSubset] = useState<string>('')
  const [restrictTo, setRestrictTo] = useState<MarkerRestriction | null>(null)

  // Fetch boolean columns when modal opens
  useEffect(() => {
    if (!isMarkerGenesModalOpen) return
    fetch(appendDataset('/api/var/boolean_columns', activeSlot))
      .then((res) => res.json())
      .then((cols: { name: string; n_true: number; n_total: number }[]) => {
        setBooleanColumns(cols)
        const hvg = cols.find((c) => c.name === 'highly_variable')
        setGeneSubset(hvg ? 'highly_variable' : '')
      })
      .catch(() => setBooleanColumns([]))
  }, [isMarkerGenesModalOpen, activeSlot])

  // Per-group cell counts inside the cell mask (null without one), so a group
  // the mask empties is visible before Run rather than missing after it.
  const [maskedCounts, setMaskedCounts] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (!isMarkerGenesModalOpen || !markerGenesColumn || !activeCellMask) {
      setMaskedCounts(null)
      return
    }
    let cancelled = false
    fetch(appendDataset(`/api/obs/${encodeURIComponent(markerGenesColumn)}`, activeSlot))
      .then((res) => (res.ok ? res.json() : null))
      .then((col: ObsColumnData | null) => {
        if (!cancelled) setMaskedCounts(col ? maskedCategoryCounts(col, activeCellMask) : null)
      })
      .catch(() => { if (!cancelled) setMaskedCounts(null) })
    return () => { cancelled = true }
  }, [isMarkerGenesModalOpen, markerGenesColumn, activeCellMask, activeSlot])

  // Results state
  const [results, setResults] = useState<MarkerGenesGroupResult[] | null>(null)
  // Which cells the shown results came from: the folder name and summary line
  // use the label; the mask it was run under decides whether they still hold.
  const [resultScope, setResultScope] = useState<string | null>(null)
  const [resultCells, setResultCells] = useState(0)
  const [resultMask, setResultMask] = useState<boolean[] | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [addedToSets, setAddedToSets] = useState(false)
  // The stored run the shown results were selected from, and what the run
  // answered for: Top N and the thresholds re-select from the stored
  // ranking; only a change of column, groups, gene subset or mask re-runs.
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [resultSignature, setResultSignature] = useState<string | null>(null)
  const [resultTruncated, setResultTruncated] = useState(false)
  const [storedPerGroup, setStoredPerGroup] = useState<number | null>(null)
  const lastSelection = useRef<string | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)

  // Results answer for the cells they were run on. This modal never unmounts,
  // so a mask changed while it was closed would otherwise leave markers for
  // the old cells under the new scope note. Masks are replaced, not mutated.
  useEffect(() => {
    if (results && activeCellMask !== resultMask) {
      setResults(null)
      setAddedToSets(false)
    }
  }, [activeCellMask, resultMask, results])

  // Get the summary for the selected column
  const columnSummary = summaries.find((s) => s.name === markerGenesColumn)
  const categories = columnSummary?.categories || []

  const signature = markerGenesColumn ? runSignature({ obsColumn: markerGenesColumn, selectedGroups, geneSubset }, activeCellMask) : null
  const runIsCurrent = Boolean(resultKey && results && signature === resultSignature)

  // Top N or a threshold changed after a run: re-select from the stored
  // ranking (debounced), never re-run the test.
  useEffect(() => {
    if (!runIsCurrent || !resultKey) return
    const selection = selectionFromModal(topN, minInGroupFraction, maxOutGroupFraction, minFoldChange, restrictTo)
    const wanted = JSON.stringify(selection)
    if (wanted === lastSelection.current) return
    const handle = window.setTimeout(async () => {
      setIsSelecting(true)
      try {
        const response = await selectMarkerGenes(resultKey, selection, activeSlot)
        lastSelection.current = wanted
        setResults(response.results)
        setResultTruncated(response.truncated)
        setAddedToSets(false)
      } catch (err) {
        setErrorMsg((err as Error).message)
      } finally {
        setIsSelecting(false)
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [runIsCurrent, resultKey, topN, minInGroupFraction, maxOutGroupFraction, minFoldChange, restrictTo, activeSlot])

  // Snapshot the pre-checked categories when modal opens (to avoid re-triggering on every toggle)
  const preCheckedRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (isMarkerGenesModalOpen && markerGenesColumn) {
      preCheckedRef.current =
        comparisonCheckedColumn === markerGenesColumn && comparisonCheckedCategories.size > 0
          ? new Set(comparisonCheckedCategories)
          : null
    }
  // Only capture on open
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMarkerGenesModalOpen, markerGenesColumn])

  // Initialize selected groups when column changes or categories load
  useEffect(() => {
    if (markerGenesColumn && categories.length > 0) {
      if (preCheckedRef.current && preCheckedRef.current.size > 0) {
        setSelectedGroups(new Set(preCheckedRef.current))
      } else {
        setSelectedGroups(new Set(categories.map((c) => c.value)))
      }
      setResults(null)
      setErrorMsg(null)
      setAddedToSets(false)
    }
  }, [markerGenesColumn, categories.length])

  const toggleGroup = useCallback((group: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) {
        next.delete(group)
      } else {
        next.add(group)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedGroups.size === categories.length) {
      setSelectedGroups(new Set())
    } else {
      setSelectedGroups(new Set(categories.map((c) => c.value)))
    }
  }, [categories, selectedGroups.size])

  const handleRun = useCallback(async () => {
    if (!markerGenesColumn || selectedGroups.size < 2) return

    setIsRunning(true)
    setErrorMsg(null)
    setResults(null)
    setAddedToSets(false)

    try {
      const params = markerGenesParams({
        obsColumn: markerGenesColumn,
        selectedGroups,
        nCategories: categories.length,
        topN,
        geneSubset,
        minInGroupFraction,
        maxOutGroupFraction,
        minFoldChange,
        activeCellIndices: activeCellMask ? indicesFromMask(activeCellMask) : null,
      })

      const response = await runMarkerGenes(params, activeSlot)
      setResults(response.results)
      setResultScope(activeCellMask ? (activeSubsetName ?? `${response.n_cells_tested.toLocaleString()} cells`) : null)
      setResultCells(response.n_cells_tested)
      setResultMask(activeCellMask)
      setResultKey(response.key)
      setResultSignature(runSignature({ obsColumn: markerGenesColumn, selectedGroups, geneSubset }, activeCellMask))
      setResultTruncated(response.truncated)
      const stored = Object.values(response.n_stored_per_group)
      setStoredPerGroup(stored.length ? Math.max(...stored) : null)
      lastSelection.current = JSON.stringify(selectionFromModal(topN, minInGroupFraction, maxOutGroupFraction, minFoldChange, restrictTo))
      // Auto-expand first group
      if (response.results.length > 0) {
        setExpandedGroups(new Set([response.results[0].group]))
      }
    } catch (err) {
      setErrorMsg((err as Error).message)
    } finally {
      setIsRunning(false)
    }
  }, [markerGenesColumn, selectedGroups, categories.length, topN, geneSubset, minInGroupFraction, maxOutGroupFraction, minFoldChange, restrictTo, activeSlot, activeCellMask, activeSubsetName])

  const handleAddToGeneSets = useCallback(() => {
    if (!results || !markerGenesColumn) return

    const geneSets = results
      .filter((r) => r.genes.length > 0)
      .map((r) => ({
        name: `${r.group} markers`,
        genes: r.genes.map((g) => g.gene),
      }))

    if (geneSets.length === 0) return

    const folderName = resultScope ? `${markerGenesColumn} markers (${resultScope})` : `${markerGenesColumn} markers`
    addFolderToCategory('marker_genes', folderName, geneSets)
    setAddedToSets(true)
  }, [results, resultScope, markerGenesColumn, addFolderToCategory])

  // Hand the current selection to the Heatmap tab as its row source: top N
  // and the thresholds travel as the selection, resolved server-side.
  const handlePlot = useCallback(() => {
    if (!resultKey || !markerGenesColumn) return
    const sel = selectionFromModal(topN, minInGroupFraction, maxOutGroupFraction, minFoldChange, restrictTo)
    setHeatmapConfig({
      selectedGeneSets: [],
      plotType: 'heatmap',
      markerSource: {
        key: resultKey, label: markerGenesColumn, topN: sel.top_n,
        minPctIn: sel.min_pct_in ?? null, maxPctOut: sel.max_pct_out ?? null, minLog2fc: sel.min_log2fc ?? null, maxPadj: null,
        rankBy: 'score', restrictTo,
      },
      dotplot: DEFAULT_DOTPLOT_OPTIONS,
      cellOrdering: 'category',
      obsColumn: markerGenesColumn,
      lineName: null,
      geneOrdering: 'as_provided',
      aggregateGeneSets: false,
      nBins: cfgDefault(['heatmap', 'n_bins'], 300),
      cellIndices: null,
      cellLabel: null,
    })
    setCenterPanelView('heatmap')
    setMarkerGenesModalOpen(false)
  }, [resultKey, markerGenesColumn, topN, minInGroupFraction, maxOutGroupFraction, minFoldChange, restrictTo, setHeatmapConfig, setCenterPanelView, setMarkerGenesModalOpen])

  const toggleResultGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) {
        next.delete(group)
      } else {
        next.add(group)
      }
      return next
    })
  }, [])

  const handleClose = useCallback(() => {
    setMarkerGenesModalOpen(false)
  }, [setMarkerGenesModalOpen])

  if (!isMarkerGenesModalOpen || !markerGenesColumn) return null

  const filtersActive = [minInGroupFraction, maxOutGroupFraction, minFoldChange].some((v) => Number.isFinite(parseFloat(v))) || restrictTo !== null
  // The cap only matters when a filter could have wanted rows beyond it, or
  // Top N asks for more than was kept.
  const capMatters = resultTruncated && (filtersActive || (storedPerGroup !== null && topN > storedPerGroup))
  const nRunnableGroups = runnableGroupCount(selectedGroups, maskedCounts)
  const canRun = nRunnableGroups >= 2 && !isRunning
  const nActive = activeCellMask ? activeCellMask.reduce((n, b) => n + (b ? 1 : 0), 0) : 0

  return (
    <div style={styles.backdrop} onClick={handleClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Find Marker Genes</h2>
          <button style={styles.closeButton} onClick={handleClose}>
            &times;
          </button>
        </div>

        <div style={styles.body}>
          <div style={styles.label}>Column</div>
          <div style={styles.columnName}>{markerGenesColumn}</div>

          {activeCellMask && (
            <div style={styles.scopeNote}>
              Scoped to the cell mask: {nActive.toLocaleString()} active cells
              {activeSubsetName ? ` (${activeSubsetName})` : ''}. Groups are compared within these
              cells only; a group needs two of them to be tested.
            </div>
          )}

          {/* Group selection */}
          <div style={styles.label}>Select Groups (min 2)</div>
          <div style={styles.groupList}>
            <div style={styles.selectAll} onClick={toggleSelectAll}>
              <input
                type="checkbox"
                checked={selectedGroups.size === categories.length}
                onChange={toggleSelectAll}
                style={styles.checkbox}
              />
              <span>Select All</span>
              <span style={styles.groupCount}>{selectedGroups.size}/{categories.length}</span>
            </div>
            {categories.map((cat) => (
              <div
                key={cat.value}
                style={{ ...styles.groupItem, ...(maskedCounts && !maskedCounts.get(cat.value) ? { opacity: 0.45 } : {}) }}
                onClick={() => toggleGroup(cat.value)}
              >
                <input
                  type="checkbox"
                  checked={selectedGroups.has(cat.value)}
                  onChange={() => toggleGroup(cat.value)}
                  style={styles.checkbox}
                />
                <span>{cat.value}</span>
                <span style={styles.groupCount}>
                  {maskedCounts
                    ? `${(maskedCounts.get(cat.value) ?? 0).toLocaleString()} of ${cat.count.toLocaleString()} cells`
                    : `${cat.count.toLocaleString()} cells`}
                </span>
              </div>
            ))}
          </div>

          {/* Gene subset */}
          <div style={styles.inputRow}>
            <span style={{ ...styles.label, marginBottom: 0, flex: 1 }}>Genes:</span>
            <select
              value={geneSubset}
              onChange={(e) => setGeneSubset(e.target.value)}
              style={{ ...styles.input, width: 'auto' }}
            >
              <option value="">All genes</option>
              {booleanColumns.map((col) => (
                <option key={col.name} value={col.name}>
                  {col.name} ({col.n_true.toLocaleString()})
                </option>
              ))}
            </select>
          </div>

          {/* Top N */}
          <div style={styles.inputRow}>
            <span style={{ ...styles.label, marginBottom: 0 }}>Top N genes per group:</span>
            <input
              type="number"
              min={1}
              max={500}
              value={topN}
              onChange={(e) => setTopN(Math.max(1, parseInt(e.target.value) || 25))}
              style={styles.input}
            />
          </div>

          {/* Advanced filters */}
          <div
            style={styles.advancedToggle}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? '\u25BC' : '\u25B6'} Advanced Filters
          </div>
          {showAdvanced && (
            <div style={styles.advancedContent}>
              <div style={styles.inputRow}>
                <span style={{ ...styles.label, marginBottom: 0, flex: 1 }}>Min % in group:</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  placeholder="e.g. 0.25"
                  value={minInGroupFraction}
                  onChange={(e) => setMinInGroupFraction(e.target.value)}
                  style={{ ...styles.input, width: '100px' }}
                />
              </div>
              <div style={styles.inputRow}>
                <span style={{ ...styles.label, marginBottom: 0, flex: 1 }}>Max % in others:</span>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  placeholder="e.g. 0.75"
                  value={maxOutGroupFraction}
                  onChange={(e) => setMaxOutGroupFraction(e.target.value)}
                  style={{ ...styles.input, width: '100px' }}
                />
              </div>
              <div style={{ ...styles.inputRow, marginBottom: 0 }}>
                <span style={{ ...styles.label, marginBottom: 0, flex: 1 }}>Min fold change:</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="e.g. 2.0"
                  value={minFoldChange}
                  onChange={(e) => setMinFoldChange(e.target.value)}
                  style={{ ...styles.input, width: '100px' }}
                />
              </div>
              <div style={{ ...styles.inputRow, marginBottom: 0 }} title="Keeps only marker genes in this set or column; the test is not re-run, and a gene outside the stored ranking cannot appear">
                <span style={{ ...styles.label, marginBottom: 0, flex: 1 }}>Show only:</span>
                <RestrictionPicker value={restrictTo} onChange={setRestrictTo} columns={booleanColumns} style={{ ...styles.input, width: 'auto', maxWidth: '220px' }} />
              </div>
            </div>
          )}

          {/* Error */}
          {errorMsg && <div style={styles.error}>{errorMsg}</div>}

          {/* Results */}
          {results && (
            <>
              <div style={styles.resultsSummary}>
                {results.length} group{results.length !== 1 ? 's' : ''},{' '}
                {results.reduce((sum, r) => sum + r.genes.length, 0)} total marker genes
                {' '}from {resultCells.toLocaleString()} cells{resultScope ? ` (cell mask: ${resultScope})` : ''}
                {isSelecting && <span style={{ color: '#4ecdc4' }}> · re-selecting…</span>}
                {resultKey && (
                  <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>
                    Stored as <span style={{ color: '#4ecdc4' }}>{resultKey}</span>
                    {storedPerGroup !== null && ` (${storedPerGroup.toLocaleString()} ranked genes per group)`}.
                    {' '}Top N and the filters select from it without re-running.
                    {capMatters && (
                      <span style={{ color: '#e9a23b' }} title="A group holds exactly the stored number of rows, so a filter may have lost candidates the store never kept. Re-run with a larger stored ranking if the lists come up short.">
                        {' '}Stored ranking is at its cap.
                      </span>
                    )}
                  </div>
                )}
              </div>
              {results.map((groupResult) => (
                <div key={groupResult.group} style={styles.resultGroup}>
                  <div
                    style={styles.resultGroupHeader}
                    onClick={() => toggleResultGroup(groupResult.group)}
                  >
                    <span>
                      {expandedGroups.has(groupResult.group) ? '\u25BC' : '\u25B6'}{' '}
                      {groupResult.group}
                    </span>
                    <span style={{ fontSize: '11px', color: '#888' }} title="Shown of those that passed the filters">
                      {groupResult.genes.length} gene{groupResult.genes.length === 1 ? '' : 's'}{filtersActive && groupResult.n_candidates > groupResult.genes.length ? ` of ${groupResult.n_candidates} passing` : ''}
                    </span>
                  </div>
                  {expandedGroups.has(groupResult.group) && groupResult.genes.length > 0 && (
                    <div style={styles.resultGeneList}>
                      <div style={{ ...styles.resultGene, fontWeight: 600, color: '#888', fontSize: '11px', borderBottom: '1px solid #1a1a2e', paddingBottom: '4px', marginBottom: '4px' }}>
                        <span style={{ flex: 1 }}>Gene</span>
                        <span style={{ width: '70px', textAlign: 'right' }}>log2FC</span>
                        <span style={{ width: '60px', textAlign: 'right' }} title="Fraction of the group's cells expressing the gene">% in</span>
                        <span style={{ width: '60px', textAlign: 'right' }} title="Fraction of the other cells expressing the gene">% out</span>
                        <span style={{ width: '80px', textAlign: 'right' }}>p-adj</span>
                      </div>
                      {groupResult.genes.map((gene) => (
                        <div key={gene.gene} style={styles.resultGene}>
                          <span style={{ flex: 1 }}>{gene.gene}</span>
                          <span style={{ ...styles.resultGeneStats, width: '70px', textAlign: 'right' }}>
                            {gene.log2fc === null ? '–' : gene.log2fc.toFixed(2)}
                          </span>
                          <span style={{ ...styles.resultGeneStats, width: '60px', textAlign: 'right' }}>
                            {gene.pct_in === null ? '–' : `${(gene.pct_in * 100).toFixed(0)}%`}
                          </span>
                          <span style={{ ...styles.resultGeneStats, width: '60px', textAlign: 'right' }}>
                            {gene.pct_out === null ? '–' : `${(gene.pct_out * 100).toFixed(0)}%`}
                          </span>
                          <span style={{ ...styles.resultGeneStats, width: '80px', textAlign: 'right' }}>
                            {gene.pval_adj === null ? '–' : gene.pval_adj < 0.001 ? gene.pval_adj.toExponential(1) : gene.pval_adj.toFixed(3)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {expandedGroups.has(groupResult.group) && groupResult.genes.length === 0 && (
                    <div style={{ padding: '8px 12px', fontSize: '12px', color: '#666', fontStyle: 'italic' }}>
                      {maskedCounts?.get(groupResult.group) === 1
                        ? 'Not tested: only one active cell in this group'
                        : 'No marker genes found'}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        <div style={styles.footer}>
          <button
            style={{ ...styles.button, ...styles.secondaryButton }}
            onClick={handleClose}
          >
            Close
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {results && !addedToSets && (
              <button
                style={{
                  ...styles.button,
                  ...styles.successButton,
                  ...(results.every((r) => r.genes.length === 0) ? styles.disabledButton : {}),
                }}
                onClick={handleAddToGeneSets}
                disabled={results.every((r) => r.genes.length === 0)}
              >
                Add to Gene Sets
              </button>
            )}
            {addedToSets && (
              <span style={{ fontSize: '12px', color: '#4ecdc4', alignSelf: 'center' }}>
                Added to Marker Genes
              </span>
            )}
            {runIsCurrent && (
              <button
                style={{ ...styles.button, ...styles.secondaryButton }}
                title="Open the Heatmap tab with these markers as the rows (top N and the filters as set here); switch to a dot plot there"
                onClick={handlePlot}
              >
                Plot…
              </button>
            )}
            {markerGenesColumn && selectedGroups.size >= 2 && (
              <button
                style={{ ...styles.button, ...styles.secondaryButton }}
                title="Preranked GSEA of each selected group vs the rest, against cached gene-set libraries"
                onClick={() => {
                  setEnrichmentSource({ kind: 'gsea', obsColumn: markerGenesColumn, groups: [...selectedGroups] })
                  setMarkerGenesModalOpen(false)
                }}
              >
                Enrichment…
              </button>
            )}
            <button
              style={{
                ...styles.button,
                ...styles.primaryButton,
                ...(!canRun ? styles.disabledButton : {}),
              }}
              onClick={handleRun}
              disabled={!canRun}
            >
              {isRunning ? 'Running...' : runIsCurrent ? 'Re-run test' : 'Run'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
