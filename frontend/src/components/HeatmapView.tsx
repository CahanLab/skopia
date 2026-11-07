/**
 * HeatmapView — the Heatmap tab of the center panel: a canvas expression
 * heatmap (genes × ordered cells) or an SVG scanpy-style dot plot (genes ×
 * groups), from gene sets and/or the top marker genes of a stored marker
 * run. Both read the same config; the plot type decides the request and the
 * renderer.
 *
 * Rollback: delete this file, HeatmapConfigModal.tsx, and remove imports
 * from App.tsx plus the heatmap state from store.ts.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useStore, HeatmapConfig } from '../store'
import { useDataActions, appendDataset, createFigure, fetchDotplotData } from '../hooks/useData'
import { heatmapFigureFromConfig, dotplotFigureFromConfig } from '../lib/figures'
import { heatmapCellScope } from '../lib/heatmapCells'
import { markerSummary, normalizeHeatmapConfig, rowsFromConfig } from '../lib/markerSelection'
import HeatmapConfigModal from './HeatmapConfigModal'
import ExpressionHeatmapFigure from './figures/ExpressionHeatmapFigure'
import ExpressionDotplotFigure from './figures/ExpressionDotplotFigure'
import type { ExpressionHeatmapData as HeatmapData, ExpressionDotplotData } from '../lib/figures'

// ---------------------------------------------------------------------------
// HeatmapView (main component)
// ---------------------------------------------------------------------------

export default function HeatmapView() {
  const rawConfig = useStore((s) => s.heatmapConfig)
  const setHeatmapConfig = useStore((s) => s.setHeatmapConfig)
  const drawnLines = useStore((s) => s.drawnLines)
  const displayPreferences = useStore((s) => s.displayPreferences)
  const activeSlot = useStore((s) => s.activeSlot)
  const refreshFigures = useStore((s) => s.refreshFigures)
  const setActiveFigureId = useStore((s) => s.setActiveFigureId)
  const setCenterPanelView = useStore((s) => s.setCenterPanelView)
  const activeCellMask = useStore((s) => s.activeCellMask)
  const activeSubsetName = useStore((s) => s.activeSubsetName)
  // A config saved before plot types and marker sources is a gene-set heatmap.
  const heatmapConfig = useMemo(() => (rawConfig ? normalizeHeatmapConfig(rawConfig) : null), [rawConfig])
  const cellScope = useMemo(
    () => heatmapCellScope(heatmapConfig?.cellIndices, activeCellMask, activeSubsetName),
    [heatmapConfig?.cellIndices, activeCellMask, activeSubsetName],
  )
  // The drawn cells alone: saving the mask as a subset renames it without
  // changing a cell, and must not recompute the plot.
  const drawnCells = useMemo(
    () => heatmapCellScope(heatmapConfig?.cellIndices, activeCellMask, null).indices,
    [heatmapConfig?.cellIndices, activeCellMask],
  )
  // Mask changes can overlap requests; only the latest may land.
  const requestSeq = useRef(0)
  const saveAsFigure = useCallback(async () => {
    if (!heatmapConfig) return
    try {
      // What the tab drew: the config's cells narrowed by the mask, under the display transform.
      const transform = displayPreferences.expressionTransform === 'log1p' ? 'log1p' as const : null
      const cfg = { ...heatmapConfig, cellIndices: cellScope.indices }
      const body = heatmapConfig.plotType === 'dotplot'
        ? dotplotFigureFromConfig(cfg, cellScope.subset, transform)
        : heatmapFigureFromConfig(cfg, cellScope.subset, transform)
      const rec = await createFigure(body, activeSlot)
      refreshFigures(); setActiveFigureId(rec.id); setCenterPanelView('figures')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [heatmapConfig, cellScope, displayPreferences.expressionTransform, activeSlot, refreshFigures, setActiveFigureId, setCenterPanelView])
  const { colorByGene } = useDataActions()

  const [configOpen, setConfigOpen] = useState(!heatmapConfig)
  const [data, setData] = useState<HeatmapData | null>(null)
  const [dotData, setDotData] = useState<ExpressionDotplotData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const plotRef = useRef<HTMLDivElement>(null)
  const [plotWidth, setPlotWidth] = useState(720)
  useEffect(() => {
    const el = plotRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPlotWidth(Math.max(320, el.clientWidth - 16)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [data, dotData])

  // Fetch when the config or the cells it draws change
  useEffect(() => {
    if (!heatmapConfig) return
    fetchPlotData(heatmapConfig, drawnCells)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatmapConfig, drawnCells])

  const fetchPlotData = async (config: ReturnType<typeof normalizeHeatmapConfig>, cellIndices: number[] | null) => {
    const seq = ++requestSeq.current
    if (cellIndices && cellIndices.length === 0) {
      // An older request still in flight is now ignored, so its finally
      // will not clear the spinner — clear it here.
      setLoading(false)
      setData(null); setDotData(null)
      setError(config.cellIndices?.length
        ? 'The cell mask excludes every cell this plot is restricted to. Reset the mask or reconfigure.'
        : 'The cell mask has no active cells. Reset the mask.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Sync drawn lines to backend if needed for line-based ordering
      if (config.plotType === 'heatmap' && config.lineName && drawnLines.length > 0) {
        const linesPayload = drawnLines.map((l) => ({
          name: l.name,
          embeddingName: l.embeddingName,
          points: l.points,
          smoothedPoints: l.smoothedPoints,
        }))
        await fetch(appendDataset('/api/lines'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: linesPayload }),
        })
      }

      const transform = displayPreferences.expressionTransform === 'log1p' ? 'log1p' : null
      const rows = rowsFromConfig(config)

      if (config.plotType === 'dotplot') {
        const d = config.dotplot
        const result = await fetchDotplotData({
          ...rows,
          obs_column: config.obsColumn,
          transform,
          cell_indices: cellIndices,
          expression_cutoff: d.expressionCutoff,
          color_by: d.colorBy,
          standard_scale: d.standardScale,
          gene_ordering: d.geneOrdering,
          groups: d.groups && d.groups.length ? d.groups : null,
          group_ordering: d.groupOrdering,
        }, activeSlot)
        if (seq !== requestSeq.current) return
        setData(null)
        setDotData(result)
        return
      }

      const response = await fetch(appendDataset('/api/heatmap/data'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...rows,
          aggregate_gene_sets: config.aggregateGeneSets,
          cell_ordering: config.cellOrdering,
          obs_column: config.obsColumn,
          line_name: config.lineName,
          gene_ordering: config.geneOrdering,
          n_bins: config.nBins,
          transform,
          cell_indices: cellIndices,
        }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
        throw new Error(err.detail || `HTTP ${response.status}`)
      }

      const result: HeatmapData = await response.json()
      if (seq !== requestSeq.current) return
      setDotData(null)
      setData(result)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setError((err as Error).message)
      setData(null); setDotData(null)
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }

  const handleGeneClick = useCallback((gene: string) => {
    colorByGene(gene)
  }, [colorByGene])

  // Show config panel
  if (configOpen || !heatmapConfig) {
    return (
      <HeatmapConfigModal
        config={heatmapConfig}
        onApply={(config: HeatmapConfig) => {
          setHeatmapConfig(config)
          setConfigOpen(false)
        }}
        onCancel={() => setConfigOpen(false)}
      />
    )
  }

  const isDotplot = heatmapConfig.plotType === 'dotplot'

  if (loading) {
    return (
      <div style={hmStyles.centered}>
        <div style={{ color: '#aaa', fontSize: '14px' }}>Computing {isDotplot ? 'dot plot' : 'heatmap'}...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={hmStyles.centered}>
        <div style={{ color: '#e94560', fontSize: '13px', marginBottom: '12px' }}>{error}</div>
        <button style={hmStyles.settingsButton} onClick={() => setConfigOpen(true)}>
          Reconfigure
        </button>
      </div>
    )
  }

  const empty = isDotplot ? (!dotData || dotData.genes.length === 0) : (!data || data.matrix.length === 0)
  const nHidden = isDotplot ? dotData?.n_genes_hidden : data?.n_genes_hidden
  if (empty) {
    return (
      <div style={hmStyles.centered}>
        <div style={{ color: '#888', fontSize: '13px', marginBottom: '12px' }}>
          {nHidden
            ? `${nHidden === 1 ? 'The selected gene is' : `All ${nHidden} selected genes are`} hidden by the active gene mask (Genes ⋯ → Gene mask…).`
            : heatmapConfig.markerSource
              ? 'No marker gene passed the filters. Loosen them or raise Top N.'
              : 'No data to display. Check that selected gene sets contain valid genes.'}
        </div>
        <button style={hmStyles.settingsButton} onClick={() => setConfigOpen(true)}>
          Configure {isDotplot ? 'Dot Plot' : 'Heatmap'}
        </button>
      </div>
    )
  }

  const markerNote = heatmapConfig.markerSource ? ` · ${markerSummary(heatmapConfig.markerSource)}` : ''

  return (
    <div style={hmStyles.wrapper}>
      {/* Toolbar */}
      <div style={hmStyles.toolbar}>
        <button style={hmStyles.settingsButton} onClick={() => setConfigOpen(true)}>
          Settings
        </button>
        <button style={hmStyles.settingsButton} onClick={saveAsFigure} title="Keep this plot as a figure record (Figures tab): editable, exportable, with provenance">
          Save as figure
        </button>
        <span style={hmStyles.info}>
          {isDotplot && dotData ? (
            <>
              {dotData.genes.length} genes &times; {dotData.categories.length} groups of {dotData.obs_column} ({dotData.n_cells.toLocaleString()} cells)
            </>
          ) : data ? (
            <>
              {data.row_labels.length} genes &times; {data.n_bins} {data.n_bins < data.n_cells ? 'bins' : 'cells'}
              {data.n_bins < data.n_cells && ` (${data.n_cells.toLocaleString()} cells)`}
            </>
          ) : null}
          {markerNote}
          {heatmapConfig?.cellLabel && ` · ${heatmapConfig.cellLabel}`}
          {activeCellMask && ` · cell mask${activeSubsetName ? ` (${activeSubsetName})` : ''}`}
          {data?.cell_ordering_method === 'centroids' && (
            <span
              style={{ color: '#e9a23b' }}
              title="Too many cells for exact hierarchical clustering: the cells were collapsed to 500 k-means centroids, the centroids were clustered, and each centroid's cells were laid out along the axis to the next one."
            >
              {' · cells clustered via centroids'}
            </span>
          )}
          {!!nHidden && (
            <span
              style={{ color: '#e9a23b' }}
              title="These genes are in the chosen sets but hidden by the active gene mask (Genes ⋯ → Gene mask…)."
            >
              {` · ${nHidden} hidden by gene mask`}
            </span>
          )}
        </span>
        <span style={hmStyles.hint}>Click a gene {isDotplot ? 'label' : 'row'} to color scatter plot</span>
      </div>

      {isDotplot && dotData ? (
        <div ref={plotRef} style={hmStyles.svgContainer}>
          <ExpressionDotplotFigure data={dotData} params={dotplotFigureFromConfig(heatmapConfig, null).params} width={plotWidth} onGeneClick={handleGeneClick} />
        </div>
      ) : data ? (
        <ExpressionHeatmapFigure data={data} onGeneClick={handleGeneClick} legends="floating" />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const hmStyles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderBottom: '1px solid #0f3460',
    flexShrink: 0,
  },
  settingsButton: {
    padding: '4px 12px',
    fontSize: '12px',
    backgroundColor: '#0f3460',
    color: '#aaa',
    border: '1px solid #1a1a2e',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  info: {
    fontSize: '12px',
    color: '#888',
  },
  hint: {
    fontSize: '11px',
    color: '#555',
    marginLeft: 'auto',
  },
  centered: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: '20px',
  },
  svgContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '8px',
  },
}
