/**
 * HeatmapConfigModal — inline configuration panel for the Heatmap tab.
 *
 * Rendered inside the center panel when the user first switches to the
 * Heatmap tab or clicks the Settings button. Lets the user choose:
 *   - Plot: an expression heatmap (genes × ordered cells) or a scanpy-style
 *     dot plot (genes × groups)
 *   - Rows: gene sets, and/or the top marker genes of a stored marker run
 *     (top N and the filters select from the stored ranking; nothing re-runs)
 *   - Cell ordering, gene ordering, aggregation and bins (heatmap)
 *   - Group-by column and dot options (dot plot)
 *
 * Rollback: delete this file and remove imports from HeatmapView.tsx.
 */

import { useState, useEffect, useRef } from 'react'
import { orderSelectedSets, groupLabel, folderSelectionState, restoreSelectedIds } from '../lib/heatmapGroups'
import { DEFAULT_DOTPLOT_OPTIONS, type DotplotOptions, type MarkerSource } from '../lib/markerSelection'
import { useStore, HeatmapConfig, GeneSetCategoryType, cfgDefault } from '../store'
import { getAllGeneSets, CATEGORY_ORDER, type FlatGeneSet } from '../lib/flatGeneSets'
import RestrictionPicker from './RestrictionPicker'
import { type MarkerRestriction } from '../lib/markerSelection'
import { fetchMarkerRuns, appendDataset, type MarkerRunSummary } from '../hooks/useData'

const CATEGORY_NAMES: Record<GeneSetCategoryType, string> = {
  manual: 'Manual',
  gene_clusters: 'Gene Clusters',
  similar_genes: 'Similar Genes',
  diff_exp: 'Diff. Expression',
  spatial: 'Spatial',
  marker_genes: 'Marker Genes',
  line_association: 'Line Association',
  enrichment: 'Enrichment',
}



/** A folder header with a tri-state checkbox: none, some or all of its sets picked. */
function FolderRow({ name, state, onToggle }: { name: string; state: 'none' | 'some' | 'all'; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <label style={{ ...styles.checkboxRow, fontWeight: 600 }} title="Select every set in this folder">
      <input ref={ref} type="checkbox" checked={state === 'all'} onChange={onToggle} />
      <span style={{ ...styles.geneSetName, color: '#4ecdc4' }}>{name}</span>
    </label>
  )
}

/** What the run picker shows for a stored marker run. */
export function markerRunLabel(r: MarkerRunSummary): string {
  const scope = r.cell_subset ? ` · ${r.cell_subset}` : r.n_cell_indices ? ` · ${r.n_cell_indices.toLocaleString()} masked cells` : ''
  const when = r.created_at ? ` · ${r.created_at.slice(0, 16).replace('T', ' ')}` : ''
  return `${r.key} — ${r.obs_column}, ${r.n_groups} groups${r.label ? ` (${r.label})` : ''}${scope}${when}`
}

const numOrNull = (s: string): number | null => {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

interface Props {
  config: HeatmapConfig | null
  onApply: (config: HeatmapConfig) => void
  onCancel: () => void
}

export default function HeatmapConfigModal({ config, onApply, onCancel }: Props) {
  const geneSetCategories = useStore((s) => s.geneSetCategories)
  const schema = useStore((s) => s.schema)
  const drawnLines = useStore((s) => s.drawnLines)
  const activeCellMask = useStore((s) => s.activeCellMask)
  const activeSlot = useStore((s) => s.activeSlot)
  const isMarkerGenesModalOpen = useStore((s) => s.isMarkerGenesModalOpen)
  const setMarkerGenesColumn = useStore((s) => s.setMarkerGenesColumn)
  const setMarkerGenesModalOpen = useStore((s) => s.setMarkerGenesModalOpen)
  const nActive = activeCellMask ? activeCellMask.reduce((n, b) => n + (b ? 1 : 0), 0) : 0

  const allGeneSets = getAllGeneSets(geneSetCategories)

  // The boolean .var columns the restriction picker offers (same source as the marker modal).
  useEffect(() => {
    let live = true
    fetch(appendDataset('/api/var/boolean_columns', activeSlot))
      .then((r) => r.json())
      .then((cols: { name: string; n_true: number }[]) => { if (live) setBooleanColumns(cols) })
      .catch(() => { if (live) setBooleanColumns([]) })
    return () => { live = false }
  }, [activeSlot])
  const nonEmptySets = allGeneSets.filter((gs) => gs.genes.length > 0)

  // Initialize from existing config or defaults
  const [plotType, setPlotType] = useState<'heatmap' | 'dotplot'>(config?.plotType ?? 'heatmap')
  const [rowSource, setRowSource] = useState<'gene_sets' | 'markers'>(config?.markerSource ? 'markers' : 'gene_sets')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => restoreSelectedIds(config?.selectedGeneSets ?? [], nonEmptySets)
  )
  const [cellOrdering, setCellOrdering] = useState<HeatmapConfig['cellOrdering']>(config?.cellOrdering ?? cfgDefault(['heatmap', 'cell_ordering'], 'none' as HeatmapConfig['cellOrdering']))
  const [obsColumn, setObsColumn] = useState<string | null>(config?.obsColumn ?? null)
  const [lineName, setLineName] = useState<string | null>(config?.lineName ?? null)
  const [geneOrdering, setGeneOrdering] = useState<HeatmapConfig['geneOrdering']>(config?.geneOrdering ?? cfgDefault(['heatmap', 'gene_ordering'], 'as_provided' as HeatmapConfig['geneOrdering']))
  const [aggregateGeneSets, setAggregateGeneSets] = useState(config?.aggregateGeneSets ?? cfgDefault(['heatmap', 'aggregate_gene_sets'], false))
  const [nBins, setNBins] = useState(config?.nBins ?? cfgDefault(['heatmap', 'n_bins'], 300))
  const [keepCellSubset, setKeepCellSubset] = useState(true)
  const [dotplot, setDotplot] = useState<DotplotOptions>({ ...DEFAULT_DOTPLOT_OPTIONS, ...(config?.dotplot ?? {}) })

  // Marker source: a stored run and the selection on it (numbers kept as
  // strings so a half-typed threshold does not snap).
  const [markerRuns, setMarkerRuns] = useState<MarkerRunSummary[] | null>(null)
  const [markerKey, setMarkerKey] = useState<string>(config?.markerSource?.key ?? '')
  const [markerTopN, setMarkerTopN] = useState<number>(config?.markerSource?.topN ?? 10)
  const [minPctIn, setMinPctIn] = useState(config?.markerSource?.minPctIn != null ? String(config.markerSource.minPctIn) : '')
  const [maxPctOut, setMaxPctOut] = useState(config?.markerSource?.maxPctOut != null ? String(config.markerSource.maxPctOut) : '')
  const [minLog2fc, setMinLog2fc] = useState(config?.markerSource?.minLog2fc != null ? String(config.markerSource.minLog2fc) : '')
  const [maxPadj, setMaxPadj] = useState(config?.markerSource?.maxPadj != null ? String(config.markerSource.maxPadj) : '')
  const [rankBy, setRankBy] = useState<'score' | 'log2fc'>(config?.markerSource?.rankBy ?? 'score')
  const [restrictTo, setRestrictTo] = useState<MarkerRestriction | null>(config?.markerSource?.restrictTo ?? null)
  const [booleanColumns, setBooleanColumns] = useState<{ name: string; n_true: number }[]>([])

  // Refetched whenever the marker modal closes: a run made from the link
  // below must show up without leaving the panel.
  useEffect(() => {
    if (isMarkerGenesModalOpen) return
    let cancelled = false
    fetchMarkerRuns(activeSlot)
      .then((runs) => {
        if (cancelled) return
        setMarkerRuns(runs)
        setMarkerKey((k) => (k && runs.some((r) => r.key === k) ? k : runs[0]?.key ?? ''))
      })
      .catch(() => { if (!cancelled) setMarkerRuns([]) })
    return () => { cancelled = true }
  }, [activeSlot, isMarkerGenesModalOpen])

  const markerRun = markerRuns?.find((r) => r.key === markerKey) ?? null

  // Get categorical obs columns for ordering / grouping
  const categoricalColumns = schema
    ? schema.obs_columns.filter((c) => schema.obs_dtypes[c] === 'category')
    : []

  // Set defaults if needed
  useEffect(() => {
    if ((cellOrdering === 'category' || cellOrdering === 'category_then_similarity' || plotType === 'dotplot') && !obsColumn && categoricalColumns.length > 0) {
      setObsColumn(markerRun?.obs_column && categoricalColumns.includes(markerRun.obs_column) ? markerRun.obs_column : categoricalColumns[0])
    }
    if ((cellOrdering === 'line_position' || cellOrdering === 'line_distance' || cellOrdering === 'category_then_position') && !lineName && drawnLines.length > 0) {
      setLineName(drawnLines[0].name)
    }
  }, [cellOrdering, obsColumn, lineName, categoricalColumns, drawnLines, plotType, markerRun])

  const pickMarkerRun = (key: string) => {
    setMarkerKey(key)
    const run = markerRuns?.find((r) => r.key === key)
    // Markers read best against their own groups: order the cells by the
    // run's column unless the user already chose an ordering.
    if (run && categoricalColumns.includes(run.obs_column)) {
      setObsColumn(run.obs_column)
      if (cellOrdering === 'none') setCellOrdering('category')
    }
  }

  const toggleGeneSet = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // One click for a whole folder — a pathway bundle's roles come as a folder.
  const toggleFolder = (folderName: string, category: GeneSetCategoryType) => {
    const ids = nonEmptySets.filter((gs) => gs.category === category && gs.folderName === folderName).map((gs) => gs.id)
    const state = folderSelectionState(nonEmptySets.filter((gs) => gs.category === category), folderName, selectedIds)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (state === 'all') ids.forEach((id) => next.delete(id))
      else ids.forEach((id) => next.add(id))
      return next
    })
  }

  const selectAllGeneSets = () => {
    setSelectedIds(new Set(nonEmptySets.map((gs) => gs.id)))
  }

  const selectNoneGeneSets = () => {
    setSelectedIds(new Set())
  }

  const needsCategory = cellOrdering === 'category' || cellOrdering === 'category_then_position' || cellOrdering === 'category_then_similarity'
  const needsLine = cellOrdering === 'line_position' || cellOrdering === 'line_distance' || cellOrdering === 'category_then_position'
  const usingMarkers = rowSource === 'markers' && Boolean(markerKey)
  const hasRows = usingMarkers || selectedIds.size > 0
  const canApply = hasRows && (plotType === 'heatmap' || Boolean(obsColumn))

  const handleApply = () => {
    if (!canApply) return
    // Folder order, then each folder's own set order — a pathway reads
    // ligands → receptors → … whatever order the boxes were ticked in.
    const selected = orderSelectedSets(nonEmptySets, selectedIds)
    const markerSource: MarkerSource | null = usingMarkers && markerRun ? {
      key: markerRun.key, label: markerRun.obs_column, topN: Math.max(1, markerTopN),
      minPctIn: numOrNull(minPctIn), maxPctOut: numOrNull(maxPctOut), minLog2fc: numOrNull(minLog2fc), maxPadj: numOrNull(maxPadj),
      rankBy, restrictTo,
    } : null

    onApply({
      selectedGeneSets: selected.map((gs) => ({ id: gs.id, name: groupLabel(gs, selected), genes: gs.genes })),
      plotType,
      markerSource,
      dotplot,
      cellOrdering,
      obsColumn: plotType === 'dotplot' || needsCategory ? obsColumn : null,
      lineName: plotType === 'heatmap' && needsLine ? lineName : null,
      geneOrdering,
      aggregateGeneSets,
      nBins,
      cellIndices: keepCellSubset ? config?.cellIndices ?? null : null,
      cellLabel: keepCellSubset ? config?.cellLabel ?? null : null,
    })
  }

  const openMarkerModal = () => {
    const col = obsColumn && categoricalColumns.includes(obsColumn) ? obsColumn : categoricalColumns[0]
    if (!col) return
    setMarkerGenesColumn(col)
    setMarkerGenesModalOpen(true)
  }

  const thresholdInput = (label: string, value: string, set: (v: string) => void, placeholder: string, title: string, step = 0.05) => (
    <label style={styles.thresholdRow} title={title}>
      <span style={{ flex: 1 }}>{label}</span>
      <input type="number" step={step} value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} style={{ ...styles.numberInput, width: '72px' }} />
    </label>
  )

  return (
    <div style={styles.container}>
      <div style={styles.panel}>
        <h3 style={styles.title}>Configure {plotType === 'dotplot' ? 'Dot Plot' : 'Heatmap'}</h3>

        {/* Plot type */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Plot</div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <label style={styles.radioRow} title="Genes as rows, cells (or bins of cells) as columns, ordered along an axis">
              <input type="radio" name="plotType" checked={plotType === 'heatmap'} onChange={() => setPlotType('heatmap')} />
              <span>Heatmap</span>
            </label>
            <label style={styles.radioRow} title="One dot per gene and group: size is the fraction of the group's cells expressing it, colour the mean expression (scanpy's dotplot)">
              <input type="radio" name="plotType" checked={plotType === 'dotplot'} onChange={() => setPlotType('dotplot')} disabled={categoricalColumns.length === 0} />
              <span>Dot plot</span>
            </label>
          </div>
        </div>

        {/* Rows */}
        <div style={styles.section}>
          {activeCellMask && (
            <div style={{ fontSize: '11px', color: '#e9a23b', marginBottom: '8px', padding: '6px 8px', border: '1px solid #0f3460', borderRadius: '4px' }}>
              Cell mask active ({nActive.toLocaleString()} cells): the plot draws only cells inside it.
            </div>
          )}
          {config?.cellIndices && config.cellIndices.length > 0 && (
            <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '8px', padding: '6px 8px', border: '1px solid #0f3460', borderRadius: '4px' }}>
              <label style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={keepCellSubset} onChange={(e) => setKeepCellSubset(e.target.checked)} style={{ marginRight: '6px' }} />
                Restrict to {config.cellIndices.length.toLocaleString()} cells{config.cellLabel ? ` (${config.cellLabel})` : ''}
              </label>
            </div>
          )}
          <div style={styles.sectionTitle}>Rows</div>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
            <label style={styles.radioRow}>
              <input type="radio" name="rowSource" checked={rowSource === 'gene_sets'} onChange={() => setRowSource('gene_sets')} />
              <span>Gene sets</span>
            </label>
            <label style={styles.radioRow} title="The top marker genes of each group from a stored marker run; top N and the filters select from the stored ranking without re-running the test">
              <input type="radio" name="rowSource" checked={rowSource === 'markers'} onChange={() => setRowSource('markers')} />
              <span>Top marker genes</span>
            </label>
          </div>

          {rowSource === 'markers' && (
            <div style={styles.markerBox} data-marker-source>
              {markerRuns === null ? (
                <div style={styles.hint}>Loading marker runs…</div>
              ) : markerRuns.length === 0 ? (
                <div style={styles.hint}>
                  No marker run stored yet.{' '}
                  <span style={styles.link} onClick={openMarkerModal}>Find marker genes…</span>
                </div>
              ) : (
                <>
                  <select style={{ ...styles.inlineSelect, marginLeft: 0, width: '100%', marginBottom: '8px' }} value={markerKey} onChange={(e) => pickMarkerRun(e.target.value)}>
                    {markerRuns.map((r) => <option key={r.key} value={r.key}>{markerRunLabel(r)}</option>)}
                  </select>
                  <label style={styles.thresholdRow}>
                    <span style={{ flex: 1 }}>Top N per group</span>
                    <input type="number" min={1} max={500} value={markerTopN} onChange={(e) => setMarkerTopN(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...styles.numberInput, width: '72px' }} />
                  </label>
                  {thresholdInput('Min % in group', minPctIn, setMinPctIn, 'e.g. 0.25', 'Fraction of the group\'s cells expressing the gene (0..1); blank = no filter')}
                  {thresholdInput('Max % in others', maxPctOut, setMaxPctOut, 'e.g. 0.5', 'Fraction of the other cells expressing the gene (0..1); blank = no filter')}
                  {thresholdInput('Min log2 fold change', minLog2fc, setMinLog2fc, 'e.g. 1', 'Blank = no filter', 0.25)}
                  {thresholdInput('Max adjusted p', maxPadj, setMaxPadj, 'e.g. 0.05', 'Blank = no filter', 0.01)}
                  <label style={styles.thresholdRow}>
                    <span style={{ flex: 1 }}>Rank by</span>
                    <select style={{ ...styles.inlineSelect, marginLeft: 0 }} value={rankBy} onChange={(e) => setRankBy(e.target.value as 'score' | 'log2fc')}>
                      <option value="score">Wilcoxon score</option>
                      <option value="log2fc">log2 fold change</option>
                    </select>
                  </label>
                  <label style={styles.thresholdRow} title="Keeps only marker genes in this set or column; the test is not re-run, and a gene outside the stored ranking cannot appear">
                    <span style={{ flex: 1 }}>Show only</span>
                    <RestrictionPicker value={restrictTo} onChange={setRestrictTo} columns={booleanColumns} style={{ ...styles.inlineSelect, marginLeft: 0 }} />
                  </label>
                  <div style={{ ...styles.hint, marginTop: '6px' }}>
                    Stored ranking: {markerRun?.store_top_n ?? '?'} genes per group.{' '}
                    <span style={styles.link} onClick={openMarkerModal}>Find marker genes…</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div style={styles.sectionHeader}>
            <span style={styles.subTitle}>{rowSource === 'markers' ? 'Also include gene sets' : 'Gene sets'}</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={styles.smallButton} onClick={selectAllGeneSets}>All</button>
              <button style={styles.smallButton} onClick={selectNoneGeneSets}>None</button>
            </div>
          </div>
          {nonEmptySets.length === 0 ? (
            <div style={styles.empty}>
              No gene sets with genes defined. Create gene sets in the Gene panel first.
            </div>
          ) : (
            <div style={styles.geneSetList}>
              {CATEGORY_ORDER.map((catType) => {
                const catSets = nonEmptySets.filter((gs) => gs.category === catType)
                if (catSets.length === 0) return null
                // Loose sets first, then each folder under its own header
                // with a folder-level checkbox.
                const loose = catSets.filter((gs) => !gs.folderName)
                const folderNames: string[] = []
                for (const gs of catSets) {
                  if (gs.folderName && !folderNames.includes(gs.folderName)) folderNames.push(gs.folderName)
                }
                const row = (gs: FlatGeneSet, indent: boolean) => (
                  <label key={gs.id} style={{ ...styles.checkboxRow, ...(indent ? { paddingLeft: '22px' } : {}) }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(gs.id)}
                      onChange={() => toggleGeneSet(gs.id)}
                    />
                    <span style={styles.geneSetName}>{gs.name}</span>
                    <span style={styles.geneSetCount}>({gs.genes.length})</span>
                  </label>
                )
                return (
                  <div key={catType}>
                    <div style={styles.categoryLabel}>{CATEGORY_NAMES[catType]}</div>
                    {loose.map((gs) => row(gs, false))}
                    {folderNames.map((folderName) => (
                      <div key={folderName}>
                        <FolderRow
                          name={folderName}
                          state={folderSelectionState(catSets, folderName, selectedIds)}
                          onToggle={() => toggleFolder(folderName, catType)}
                        />
                        {catSets.filter((gs) => gs.folderName === folderName).map((gs) => row(gs, true))}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {plotType === 'dotplot' ? (
          <>
            {/* Group by */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Group by</div>
              <select style={{ ...styles.inlineSelect, marginLeft: 0 }} value={obsColumn || ''} onChange={(e) => setObsColumn(e.target.value || null)}>
                {categoricalColumns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Dot options */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Dots</div>
              <label style={styles.thresholdRow}>
                <span style={{ flex: 1 }}>Colour</span>
                <select style={{ ...styles.inlineSelect, marginLeft: 0 }} value={dotplot.colorBy} onChange={(e) => setDotplot({ ...dotplot, colorBy: e.target.value as DotplotOptions['colorBy'] })}>
                  <option value="mean">mean expression (all cells in group)</option>
                  <option value="mean_expressing">mean in expressing cells</option>
                </select>
              </label>
              <label style={styles.thresholdRow}>
                <span style={{ flex: 1 }}>Scale</span>
                <select style={{ ...styles.inlineSelect, marginLeft: 0 }} value={dotplot.standardScale} onChange={(e) => setDotplot({ ...dotplot, standardScale: e.target.value as DotplotOptions['standardScale'] })}>
                  <option value="none">none</option>
                  <option value="gene">per gene, 0..1 across groups</option>
                </select>
              </label>
              <label style={styles.thresholdRow} title="A cell counts as expressing when its value exceeds this">
                <span style={{ flex: 1 }}>Expressing above</span>
                <input type="number" min={0} step={0.1} value={dotplot.expressionCutoff} onChange={(e) => setDotplot({ ...dotplot, expressionCutoff: Math.max(0, parseFloat(e.target.value) || 0) })} style={{ ...styles.numberInput, width: '72px' }} />
              </label>
              <label style={styles.thresholdRow}>
                <span style={{ flex: 1 }}>Gene order</span>
                <select style={{ ...styles.inlineSelect, marginLeft: 0 }} value={dotplot.geneOrdering} onChange={(e) => setDotplot({ ...dotplot, geneOrdering: e.target.value as DotplotOptions['geneOrdering'] })}>
                  <option value="as_provided">as provided</option>
                  <option value="peak_group">by peak group</option>
                </select>
              </label>
              <label style={styles.thresholdRow}>
                <span style={{ flex: 1 }}>Colours</span>
                <select style={{ ...styles.inlineSelect, marginLeft: 0 }} value={dotplot.colormap} onChange={(e) => setDotplot({ ...dotplot, colormap: e.target.value as DotplotOptions['colormap'] })}>
                  <option value="viridis">viridis</option>
                  <option value="reds">white – red</option>
                  <option value="rdbu">blue – white – red</option>
                </select>
              </label>
              <label style={styles.checkboxRow} title="Off: groups as rows and genes as columns, scanpy's layout">
                <input type="checkbox" checked={dotplot.swapAxes} onChange={(e) => setDotplot({ ...dotplot, swapAxes: e.target.checked })} />
                <span>Genes as rows</span>
              </label>
            </div>
          </>
        ) : (
          <>
            {/* Cell ordering */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Cell Ordering</div>
              <div style={styles.radioGroup}>
                <label style={styles.radioRow}>
                  <input type="radio" name="cellOrder" checked={cellOrdering === 'none'} onChange={() => setCellOrdering('none')} />
                  <span>None (original order)</span>
                </label>
                <label style={styles.radioRow}>
                  <input type="radio" name="cellOrder" checked={cellOrdering === 'category'} onChange={() => setCellOrdering('category')} disabled={categoricalColumns.length === 0} />
                  <span>Group by category</span>
                </label>
                {cellOrdering === 'category' && (
                  <select style={styles.inlineSelect} value={obsColumn || ''} onChange={(e) => setObsColumn(e.target.value || null)}>
                    {categoricalColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <label style={styles.radioRow}>
                  <input type="radio" name="cellOrder" checked={cellOrdering === 'line_position'} onChange={() => setCellOrdering('line_position')} disabled={drawnLines.length === 0} />
                  <span>By line position</span>
                </label>
                <label style={styles.radioRow}>
                  <input type="radio" name="cellOrder" checked={cellOrdering === 'line_distance'} onChange={() => setCellOrdering('line_distance')} disabled={drawnLines.length === 0} />
                  <span>By distance from line</span>
                </label>
                <label style={styles.radioRow}>
                  <input type="radio" name="cellOrder" checked={cellOrdering === 'category_then_position'} onChange={() => setCellOrdering('category_then_position')} disabled={categoricalColumns.length === 0 || drawnLines.length === 0} />
                  <span>Category, then position</span>
                </label>
                {cellOrdering === 'category_then_position' && (
                  <div style={{ marginLeft: '24px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <select style={styles.inlineSelect} value={obsColumn || ''} onChange={(e) => setObsColumn(e.target.value || null)}>
                      {categoricalColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}
                <label style={styles.radioRow} title="Hierarchical clustering (average linkage) of the cells on the selected genes, each gene scaled to its own range; cells with the same expression pattern sit together. Above 5,000 cells the clustering runs on 500 k-means centroids.">
                  <input type="radio" name="cellOrder" checked={cellOrdering === 'similarity'} onChange={() => setCellOrdering('similarity')} />
                  <span>By similarity (clustered)</span>
                </label>
                <label style={styles.radioRow} title="Group by category, then cluster the cells by similarity inside each group.">
                  <input type="radio" name="cellOrder" checked={cellOrdering === 'category_then_similarity'} onChange={() => setCellOrdering('category_then_similarity')} disabled={categoricalColumns.length === 0} />
                  <span>Category, then similarity</span>
                </label>
                {cellOrdering === 'category_then_similarity' && (
                  <select style={{ ...styles.inlineSelect, marginLeft: '24px' }} value={obsColumn || ''} onChange={(e) => setObsColumn(e.target.value || null)}>
                    {categoricalColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                {needsLine && (
                  <select style={{ ...styles.inlineSelect, marginLeft: '24px' }} value={lineName || ''} onChange={(e) => setLineName(e.target.value || null)}>
                    {drawnLines.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* Gene ordering */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Gene Ordering</div>
              <div style={styles.radioGroup}>
                <label style={styles.radioRow}>
                  <input type="radio" name="geneOrder" checked={geneOrdering === 'as_provided'} onChange={() => setGeneOrdering('as_provided')} />
                  <span>By gene set / marker group</span>
                </label>
                <label style={styles.radioRow}>
                  <input type="radio" name="geneOrder" checked={geneOrdering === 'peak_position'} onChange={() => setGeneOrdering('peak_position')} />
                  <span>By peak position</span>
                </label>
                <label style={styles.radioRow} title="Hierarchical clustering (average linkage) of each gene's normalised profile; genes with the same shape sit together. Within each gene set when sets are shown.">
                  <input type="radio" name="geneOrder" checked={geneOrdering === 'similarity'} onChange={() => setGeneOrdering('similarity')} />
                  <span>By similarity (clustered)</span>
                </label>
              </div>
            </div>

            {/* Aggregate toggle */}
            <div style={styles.section}>
              <label style={styles.checkboxRow}>
                <input type="checkbox" checked={aggregateGeneSets} onChange={(e) => setAggregateGeneSets(e.target.checked)} />
                <span>Show gene set aggregates (mean expression per set)</span>
              </label>
            </div>

            {/* Bin count */}
            <div style={styles.section}>
              <div style={styles.sectionTitle}>Cell Bins</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  min={0}
                  max={2000}
                  value={nBins}
                  onChange={(e) => setNBins(Math.max(0, parseInt(e.target.value) || 0))}
                  style={styles.numberInput}
                />
                <span style={styles.hint}>0 = no binning (show all cells)</span>
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <div style={styles.actions}>
          {config && (
            <button style={styles.cancelButton} onClick={onCancel}>Cancel</button>
          )}
          <button
            style={{
              ...styles.applyButton,
              opacity: canApply ? 1 : 0.4,
              cursor: canApply ? 'pointer' : 'not-allowed',
            }}
            onClick={handleApply}
            disabled={!canApply}
          >
            Generate {plotType === 'dotplot' ? 'Dot Plot' : 'Heatmap'}
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '20px',
  },
  panel: {
    backgroundColor: '#16213e',
    border: '1px solid #0f3460',
    borderRadius: '8px',
    padding: '24px',
    width: '100%',
    maxWidth: '520px',
    maxHeight: '85vh',
    overflowY: 'auto',
  },
  title: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#e94560',
    marginTop: 0,
    marginBottom: '20px',
  },
  section: {
    marginBottom: '16px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#aaa',
    textTransform: 'uppercase',
    marginBottom: '8px',
  },
  subTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#888',
  },
  categoryLabel: {
    fontSize: '10px',
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase',
    padding: '4px 0',
    marginTop: '4px',
  },
  geneSetList: {
    maxHeight: '180px',
    overflowY: 'auto',
    backgroundColor: '#0f3460',
    borderRadius: '4px',
    padding: '8px',
  },
  markerBox: {
    backgroundColor: '#0f1625',
    border: '1px solid #0f3460',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '10px',
  },
  thresholdRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '3px 0',
    fontSize: '12px',
    color: '#ccc',
  },
  link: {
    color: '#4ecdc4',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  checkboxRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 0',
    fontSize: '13px',
    color: '#ccc',
    cursor: 'pointer',
  },
  geneSetName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  geneSetCount: {
    fontSize: '11px',
    color: '#888',
  },
  radioGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  radioRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: '#ccc',
    cursor: 'pointer',
  },
  inlineSelect: {
    marginLeft: '24px',
    padding: '4px 8px',
    fontSize: '12px',
    backgroundColor: '#0f3460',
    color: '#eee',
    border: '1px solid #1a1a2e',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  numberInput: {
    width: '80px',
    padding: '6px 8px',
    fontSize: '13px',
    backgroundColor: '#0f3460',
    color: '#eee',
    border: '1px solid #1a1a2e',
    borderRadius: '4px',
  },
  hint: {
    fontSize: '11px',
    color: '#666',
  },
  smallButton: {
    padding: '2px 8px',
    fontSize: '10px',
    backgroundColor: '#0f3460',
    color: '#aaa',
    border: '1px solid #1a1a2e',
    borderRadius: '3px',
    cursor: 'pointer',
  },
  empty: {
    fontSize: '13px',
    color: '#666',
    padding: '12px',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '20px',
  },
  cancelButton: {
    padding: '8px 16px',
    fontSize: '13px',
    backgroundColor: 'transparent',
    color: '#aaa',
    border: '1px solid #0f3460',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  applyButton: {
    padding: '8px 20px',
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor: '#4ecdc4',
    color: '#000',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  },
}
