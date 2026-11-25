import { useEffect, useMemo, useState } from 'react'
import { useStore, FigurePanel as PanelType, FigureColorMode, ColorScale, type HighlightLayer } from '../store'
import { useObsSummaries } from '../hooks/useData'
import { flattenGeneSets } from './GenePanel'
import BivariateAxisPicker from './BivariateAxisPicker'
import FigurePanel from './FigurePanel'
import NumberInput from './NumberInput'
import { exportFigureAsPng } from '../utils/exportFigure'
import { cellsForFigure, figureMatchesDataset, SPEC_NONE, specForBivariate, specForColumn, specForGenes, type PanelColorSpec } from '../lib/figurePanels'
import { datasetLabel } from '../lib/datasetSlots'
import { figureInk } from '../lib/figures'

const LAYOUT_PRESETS: { label: string; rows: number; cols: number }[] = [
  { label: '1×1', rows: 1, cols: 1 },
  { label: '1×2', rows: 1, cols: 2 },
  { label: '2×1', rows: 2, cols: 1 },
  { label: '1×3', rows: 1, cols: 3 },
  { label: '2×2', rows: 2, cols: 2 },
  { label: '2×3', rows: 2, cols: 3 },
  { label: '3×3', rows: 3, cols: 3 },
]

const COLOR_SCALES: ColorScale[] = ['viridis', 'plasma', 'magma', 'inferno', 'cividis', 'coolwarm', 'blues', 'reds']

export default function FigureBuilder() {
  const figure = useStore((s) => s.activeFigure)
  const embedding = useStore((s) => s.embedding)
  const activeSlot = useStore((s) => s.activeSlot)
  const selectedCellIndices = useStore((s) => s.selectedCellIndices)
  const datasets = useStore((s) => s.datasets)
  const createFigure = useStore((s) => s.createFigure)
  const cropFigure = useStore((s) => s.cropFigure)
  const updateFigure = useStore((s) => s.updateFigure)
  const updateFigurePanel = useStore((s) => s.updateFigurePanel)
  const colorFigurePanel = useStore((s) => s.colorFigurePanel)
  const setFigurePanelTitle = useStore((s) => s.setFigurePanelTitle)
  const setActiveFigurePanel = useStore((s) => s.setActiveFigurePanel)
  const setFigureLayout = useStore((s) => s.setFigureLayout)
  const closeFigure = useStore((s) => s.closeFigure)
  const removeHighlightLayer = useStore((s) => s.removeHighlightLayer)
  const copyEmbeddingHighlightsToFigure = useStore((s) => s.copyEmbeddingHighlightsToFigure)
  const geneSetCategories = useStore((s) => s.geneSetCategories)
  const { summaries } = useObsSummaries()

  const [exportScale, setExportScale] = useState<number>(2)
  const [isExporting, setIsExporting] = useState(false)

  const allGeneSets = useMemo(() => flattenGeneSets(geneSetCategories).filter((g) => g.genes.length > 0), [geneSetCategories])
  const categoricalCols = useMemo(() => summaries.filter((s) => s.dtype === 'category' || s.dtype === 'string'), [summaries])
  const numericCols = useMemo(() => summaries.filter((s) => s.dtype === 'numeric'), [summaries])

  // No create step: opening Panels with no figure makes one of every cell on
  // the embedding the Embedding tab is showing.
  useEffect(() => {
    if (figure || !embedding || embedding.coordinates.length === 0) return
    const { indices, coordinates } = cellsForFigure(embedding.coordinates, null)
    if (indices.length === 0) return
    createFigure(indices, coordinates, embedding.name, 2, 2, { x: embedding.dim_x ?? 0, y: embedding.dim_y ?? 1 })
  }, [figure, embedding, createFigure])

  // Cropping reads positions from the Embedding tab, so it needs the figure's
  // own dataset and embedding (same columns) to be the one showing there.
  const sameEmbedding = !!figure && !!embedding && figure.slot === activeSlot && embedding.name === figure.embeddingName &&
    (embedding.dim_x ?? 0) === (figure.dimX ?? 0) && (embedding.dim_y ?? 1) === (figure.dimY ?? 1)
  const allCells = useMemo(
    () => (sameEmbedding && embedding ? cellsForFigure(embedding.coordinates, null) : null),
    [sameEmbedding, embedding],
  )

  if (!figure) {
    return (
      <div style={emptyStyle}>
        <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '8px' }}>No embedding to compose.</div>
        <div style={{ fontSize: '12px', color: '#888' }}>Load a dataset with an embedding to compose panels.</div>
      </div>
    )
  }

  // The figure's indices number the cells as they were; once cells are
  // deleted or filtered, or another file fills its slot, drawing it would
  // colour old positions with new values. Say so instead of drawing.
  if (!figureMatchesDataset(figure, datasets)) {
    return (
      <div style={emptyStyle} data-figure-stale>
        <div style={{ fontSize: '14px', color: '#aaa', marginBottom: '8px' }}>The cells under this figure have changed.</div>
        <div style={{ fontSize: '12px', color: '#888', marginBottom: '12px', maxWidth: '420px', textAlign: 'center' }}>
          Cells were deleted or filtered, or another file was loaded in its place, so its panels can no longer be drawn.
        </div>
        <button onClick={closeFigure} style={primaryButtonStyle}>New figure</button>
      </div>
    )
  }

  const activePanel = figure.panels.find((p) => p.id === figure.activePanelId) || figure.panels[0]
  const figureSlotLabel = datasetLabel(figure.slot, datasets[figure.slot]?.schema?.filename, datasets[figure.slot]?.displayName)
  const otherDataset = figure.slot !== activeSlot
  const cropCells = selectedCellIndices.length > 0 && sameEmbedding && embedding
    ? cellsForFigure(embedding.coordinates, selectedCellIndices) : null
  const isCropped = !!allCells && figure.cellIndices.length < allCells.indices.length
  const embeddingLayerCount = datasets[figure.slot]?.highlightLayers.length ?? 0
  const titleInk = figureInk(figure.background)

  const handleExport = async () => {
    setIsExporting(true)
    try {
      await exportFigureAsPng(figure, exportScale)
    } finally {
      setIsExporting(false)
    }
  }

  // Discarding is the way to a fresh figure (on whatever the Embedding tab
  // now shows); ask first when there is something to lose.
  const handleNewFigure = () => {
    const coloured = figure.panels.some((p) => p.colorMode !== 'none' || p.titleEdited) || figure.overlayLayers.length > 0
    if (coloured && !window.confirm('Discard this figure and start a new one on the current embedding?')) return
    closeFigure()
  }

  return (
    <div style={containerStyle}>
      {/* Top toolbar */}
      <div style={toolbarStyle}>
        <input
          type="text"
          placeholder="Figure title (optional)"
          value={figure.title}
          onChange={(e) => updateFigure({ title: e.target.value })}
          style={titleInputStyle}
        />
        <span style={{ ...labelStyle, marginLeft: '8px' }}>Layout</span>
        <select
          value={`${figure.rows}x${figure.cols}`}
          onChange={(e) => {
            const [r, c] = e.target.value.split('x').map(Number)
            setFigureLayout(r, c)
          }}
          style={selectStyle}
        >
          {LAYOUT_PRESETS.map((p) => (
            <option key={p.label} value={`${p.rows}x${p.cols}`}>{p.label}</option>
          ))}
        </select>
        <span style={{ ...labelStyle, marginLeft: '12px' }}>Background</span>
        <input
          type="color"
          value={figure.background}
          onChange={(e) => updateFigure({ background: e.target.value })}
          style={colorInputStyle}
        />
        <span style={{ ...labelStyle, marginLeft: '12px' }}>Point size</span>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={figure.pointSize}
          onChange={(e) => updateFigure({ pointSize: parseFloat(e.target.value) })}
          style={{ width: '90px' }}
          title="Point radius in CSS pixels (shared across all panels)"
        />
        <span style={{ ...labelStyle, fontVariantNumeric: 'tabular-nums', width: '24px' }}>{figure.pointSize.toFixed(1)}</span>
        <span style={{ ...labelStyle, marginLeft: '8px' }}>Opacity</span>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={figure.pointOpacity}
          onChange={(e) => updateFigure({ pointOpacity: parseFloat(e.target.value) })}
          style={{ width: '90px' }}
          title="Point opacity (shared across all panels)"
        />
        <span style={{ ...labelStyle, fontVariantNumeric: 'tabular-nums', width: '30px' }}>{Math.round(figure.pointOpacity * 100)}%</span>
        <span style={{ ...labelStyle, marginLeft: '12px' }}>Grid</span>
        <input
          type="checkbox"
          checked={figure.showGrid}
          onChange={(e) => updateFigure({ showGrid: e.target.checked })}
          title="Toggle N×N grid overlay on all panels"
        />
        {figure.showGrid && (
          <>
            <input
              type="color"
              value={figure.gridColor}
              onChange={(e) => updateFigure({ gridColor: e.target.value })}
              style={colorInputStyle}
              title="Grid line color"
            />
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.25}
              value={figure.gridLineWidth}
              onChange={(e) => updateFigure({ gridLineWidth: parseFloat(e.target.value) })}
              style={{ width: '60px' }}
              title="Grid line width (px)"
            />
          </>
        )}
        {cropCells && cropCells.indices.length > 0 && (
          <button
            data-figure-crop
            onClick={() => cropFigure(cropCells.indices, cropCells.coordinates)}
            style={{ ...secondaryButtonStyle, marginLeft: '12px' }}
            title="Show only the cells selected in the Embedding tab"
          >
            Crop to selection ({cropCells.indices.length.toLocaleString()})
          </button>
        )}
        {isCropped && allCells && (
          <button
            data-figure-all-cells
            onClick={() => cropFigure(allCells.indices, allCells.coordinates)}
            style={{ ...secondaryButtonStyle, marginLeft: cropCells ? '4px' : '12px' }}
          >
            All cells
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span style={labelStyle}>Export DPI</span>
        <select value={exportScale} onChange={(e) => setExportScale(Number(e.target.value))} style={selectStyle}>
          <option value={1}>1× (screen)</option>
          <option value={2}>2× (~150 DPI)</option>
          <option value={3}>3× (~225 DPI)</option>
          <option value={4}>4× (~300 DPI)</option>
        </select>
        <button onClick={handleExport} disabled={isExporting} style={primaryButtonStyle}>
          {isExporting ? 'Exporting…' : 'Export PNG'}
        </button>
        <button onClick={handleNewFigure} style={secondaryButtonStyle} title="Discard this figure and start a new one on the embedding the Embedding tab shows">
          New figure
        </button>
      </div>

      {/* Body: grid + sidebar */}
      <div style={bodyStyle}>
        {/* Grid of panels */}
        <div
          data-figure-grid="true"
          style={{
            flex: 1,
            backgroundColor: figure.background,
            display: 'grid',
            gridTemplateRows: `repeat(${figure.rows}, 1fr)`,
            gridTemplateColumns: `repeat(${figure.cols}, 1fr)`,
            gap: '8px',
            padding: figure.title ? '36px 12px 12px' : '12px',
            position: 'relative',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          {figure.title && (
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: 0,
                right: 0,
                textAlign: 'center',
                color: titleInk.title,
                fontSize: '16px',
                fontWeight: 600,
                pointerEvents: 'none',
              }}
            >
              {figure.title}
            </div>
          )}
          {figure.panels.map((p) => (
            <div
              key={p.id}
              data-figure-panel="true"
              data-panel-id={p.id}
              data-panel-active={p.id === activePanel?.id ? 'true' : undefined}
              onClick={() => setActiveFigurePanel(p.id)}
              style={{
                position: 'relative',
                cursor: 'pointer',
                // Outside the panel (in the grid gap): an inset outline is
                // painted under the positioned panel inside and never shows.
                outline: p.id === activePanel?.id ? '2px solid #4ecdc4' : 'none',
                outlineOffset: '2px',
              }}
            >
              <FigurePanel figure={figure} panel={p} isActive={p.id === activePanel?.id} />
            </div>
          ))}
        </div>

        {/* Sidebar: routing hint, the active panel's controls, the figure's overlay */}
        <div style={sidebarStyle}>
          {otherDataset ? (
            <div data-figure-slot-notice style={noticeStyle}>
              This figure shows <strong>{figureSlotLabel}</strong>. Switch back to it to colour panels from the Genes and
              Cells panes, or start a new figure here.
              <div style={{ marginTop: '6px' }}>
                <button onClick={handleNewFigure} style={secondaryButtonStyle}>New figure</button>
              </div>
            </div>
          ) : (
            <div style={{ ...hintStyle, marginLeft: 0, marginBottom: '10px' }}>
              Click a panel, then colour it from the Genes or Cells pane. Click a title on the plot to rename it.
            </div>
          )}
          {activePanel && (
            <PanelControls
              panel={activePanel}
              allGeneSets={allGeneSets}
              categoricalCols={categoricalCols.map((c) => c.name)}
              numericCols={numericCols.map((c) => c.name)}
              onUpdate={(patch) => updateFigurePanel(activePanel.id, patch)}
              onColor={(spec) => colorFigurePanel(activePanel.id, spec)}
              onTitle={(title) => setFigurePanelTitle(activePanel.id, title)}
            />
          )}
          <OverlaySection
            layers={figure.overlayLayers}
            embeddingLayerCount={embeddingLayerCount}
            onRemove={removeHighlightLayer}
            onCopy={copyEmbeddingHighlightsToFigure}
            routing={!otherDataset}
          />
        </div>
      </div>

      <div style={footerStyle}>
        {figure.cellIndices.length.toLocaleString()} cells · embedding: {figure.embeddingName} · dataset: {figureSlotLabel}
      </div>
    </div>
  )
}

function OverlaySection({ layers, embeddingLayerCount, onRemove, onCopy, routing }: {
  layers: HighlightLayer[]
  embeddingLayerCount: number
  onRemove: (id: string) => void
  onCopy: () => void
  routing: boolean
}) {
  return (
    <div data-figure-overlay style={{ marginTop: '4px' }}>
      <div style={{ height: '1px', backgroundColor: '#333', margin: '12px 0' }} />
      <div style={sectionHeadStyle}>Overlay (all panels)</div>
      {layers.length === 0 && (
        <div style={{ ...hintStyle, marginLeft: 0 }}>
          {routing ? 'Add highlight layers with 🖍 in the Genes pane while Panels is open.' : 'No highlight layers.'}
        </div>
      )}
      {layers.map((l) => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: l.color, flexShrink: 0 }} />
          <span style={{ ...labelStyle, color: '#ccc', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {l.source.label}
          </span>
          <button onClick={() => onRemove(l.id)} style={iconButtonStyle} title="Remove this layer">×</button>
        </div>
      ))}
      {embeddingLayerCount > 0 && (
        <button onClick={onCopy} style={{ ...secondaryButtonStyle, marginTop: '6px', fontSize: '11px' }}
          title={layers.length ? "Replace this overlay with the Embedding tab's highlight layers" : "Start from the Embedding tab's highlight layers"}>
          Copy from Embedding ({embeddingLayerCount})
        </button>
      )}
    </div>
  )
}

function PanelControls({
  panel,
  allGeneSets,
  categoricalCols,
  numericCols,
  onUpdate,
  onColor,
  onTitle,
}: {
  panel: PanelType
  allGeneSets: { id: string; name: string; genes: string[] }[]
  categoricalCols: string[]
  numericCols: string[]
  onUpdate: (patch: Partial<Omit<PanelType, 'id'>>) => void
  onColor: (spec: PanelColorSpec) => void
  onTitle: (title: string) => void
}) {
  const [customGene, setCustomGene] = useState<string>('')
  const [titleDraft, setTitleDraft] = useState<string | null>(null)

  // The sidebar's bivariate axes are keyed by gene-set NAME; present the
  // picker with name-as-id so its value matches.
  const bivAxisSets = useMemo(
    () => allGeneSets.map((gs) => ({ id: gs.name, name: gs.name, genes: gs.genes })),
    [allGeneSets],
  )

  const handleColorModeChange = (mode: FigureColorMode) => {
    onColor({ ...SPEC_NONE, colorMode: mode })
    setCustomGene('')
  }

  // A bivariate pick colours the panel once both axes resolve to genes; the
  // picker's own choices are kept so it can show them.
  const pickBivariate = (axis: 1 | 2, kind: 'gene' | 'set', value: string | null) => {
    const picks = {
      bivariateGene1: panel.bivariateGene1, bivariateSet1: panel.bivariateSet1,
      bivariateGene2: panel.bivariateGene2, bivariateSet2: panel.bivariateSet2,
    }
    if (axis === 1) { picks.bivariateGene1 = kind === 'gene' ? value : null; picks.bivariateSet1 = kind === 'set' ? value : null }
    else { picks.bivariateGene2 = kind === 'gene' ? value : null; picks.bivariateSet2 = kind === 'set' ? value : null }
    const resolve = (gene: string | null, set: string | null) =>
      gene ? { genes: [gene], label: gene } : { genes: allGeneSets.find((g) => g.name === set)?.genes ?? [], label: set }
    const a = resolve(picks.bivariateGene1, picks.bivariateSet1)
    const b = resolve(picks.bivariateGene2, picks.bivariateSet2)
    if (a.genes.length && b.genes.length) onColor({ ...specForBivariate(a.genes, b.genes, a.label, b.label), ...picks })
    else onUpdate(picks)
  }

  const isCategory = panel.colorMode === 'metadata' && !!panel.selectedColorColumn && categoricalCols.includes(panel.selectedColorColumn)
  const isContinuous = panel.colorMode === 'expression' || panel.colorMode === 'score' ||
    (panel.colorMode === 'metadata' && !!panel.selectedColorColumn && numericCols.includes(panel.selectedColorColumn))

  return (
    <div>
      <div style={sectionHeadStyle}>Active panel</div>

      <ControlRow label="Title">
        <input
          type="text"
          value={titleDraft ?? panel.title}
          placeholder="automatic"
          onFocus={() => setTitleDraft(panel.title)}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => { if (titleDraft !== null && titleDraft !== panel.title) onTitle(titleDraft); setTitleDraft(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          style={inputStyle}
        />
      </ControlRow>

      <ControlRow label="Color">
        <select value={panel.colorMode} onChange={(e) => handleColorModeChange(e.target.value as FigureColorMode)} style={inputStyle}>
          <option value="none">none</option>
          <option value="expression">gene / gene set</option>
          <option value="bivariate">bivariate (genes / sets)</option>
          <option value="metadata">metadata</option>
          {panel.colorMode === 'score' && <option value="score">score column</option>}
        </select>
      </ControlRow>

      {panel.colorMode === 'expression' && (
        <>
          <ControlRow label="Gene set">
            <select
              value={panel.selectedGeneSetName ?? ''}
              onChange={(e) => {
                const gs = allGeneSets.find((g) => g.name === e.target.value)
                onColor(gs ? specForGenes(gs.genes, gs.name) : { ...SPEC_NONE, colorMode: 'expression' })
                setCustomGene('')
              }}
              style={inputStyle}
            >
              <option value="">— pick gene set —</option>
              {panel.selectedGeneSetName && !allGeneSets.some((g) => g.name === panel.selectedGeneSetName) && (
                <option value={panel.selectedGeneSetName}>{panel.selectedGeneSetName}</option>
              )}
              {allGeneSets.map((gs) => (
                <option key={gs.id} value={gs.name}>{gs.name} ({gs.genes.length})</option>
              ))}
            </select>
          </ControlRow>
          <ControlRow label="Or gene">
            <input
              type="text"
              placeholder="e.g. Prrx1"
              value={customGene}
              onChange={(e) => setCustomGene(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customGene.trim()) onColor(specForGenes([customGene.trim()]))
              }}
              onBlur={() => {
                if (customGene.trim() && (panel.selectedGenes.length !== 1 || panel.selectedGenes[0] !== customGene.trim())) {
                  onColor(specForGenes([customGene.trim()]))
                }
              }}
              style={inputStyle}
            />
          </ControlRow>
          {panel.selectedGenes.length > 0 && !panel.selectedGeneSetName && (
            <div style={hintStyle}>Showing: {panel.selectedGenes.join(', ')}</div>
          )}
        </>
      )}

      {panel.colorMode === 'score' && panel.scoreSource && (
        <div style={hintStyle}>{panel.scoreSource.obsm} · {panel.scoreSource.column}</div>
      )}

      {panel.colorMode === 'bivariate' && (
        <>
          <ControlRow label="Axis 1 (red)">
            <BivariateAxisPicker
              kind={panel.bivariateGene1 ? 'gene' : 'set'}
              value={panel.bivariateGene1 ?? panel.bivariateSet1 ?? null}
              geneSets={bivAxisSets}
              excludeSetId={panel.bivariateSet2 ?? null}
              onChange={(kind, value) => pickBivariate(1, kind, value)}
            />
          </ControlRow>
          <ControlRow label="Axis 2 (blue)">
            <BivariateAxisPicker
              kind={panel.bivariateGene2 ? 'gene' : 'set'}
              value={panel.bivariateGene2 ?? panel.bivariateSet2 ?? null}
              geneSets={bivAxisSets}
              excludeSetId={panel.bivariateSet1 ?? null}
              onChange={(kind, value) => pickBivariate(2, kind, value)}
            />
          </ControlRow>
          {!panel.bivariateGene1 && !panel.bivariateSet1 && panel.bivariateLabel1 && (
            <div style={hintStyle}>Showing: {panel.bivariateLabel1} vs {panel.bivariateLabel2}</div>
          )}
          <ControlRow label="Colormap">
            <select
              value={panel.bivariateColormap}
              onChange={(e) => onUpdate({ bivariateColormap: e.target.value as PanelType['bivariateColormap'] })}
              style={inputStyle}
            >
              <option value="default">default (red / blue)</option>
              <option value="pinkgreen">pink / green</option>
              <option value="orangepurple">orange / purple</option>
              <option value="custom">custom</option>
            </select>
          </ControlRow>
        </>
      )}

      {panel.colorMode === 'metadata' && (
        <ControlRow label="Column">
          <select value={panel.selectedColorColumn ?? ''} onChange={(e) => onColor(e.target.value ? specForColumn(e.target.value) : { ...SPEC_NONE, colorMode: 'metadata' })} style={inputStyle}>
            <option value="">— pick column —</option>
            {categoricalCols.length > 0 && <optgroup label="Categorical">
              {categoricalCols.map((c) => <option key={c} value={c}>{c}</option>)}
            </optgroup>}
            {numericCols.length > 0 && <optgroup label="Numeric">
              {numericCols.map((c) => <option key={c} value={c}>{c}</option>)}
            </optgroup>}
          </select>
        </ControlRow>
      )}

      {isContinuous && (
        <ControlRow label="Color scale">
          <select value={panel.colorScale} onChange={(e) => onUpdate({ colorScale: e.target.value as ColorScale })} style={inputStyle}>
            {COLOR_SCALES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </ControlRow>
      )}

      {isCategory && (
        <ControlRow label="Labels">
          <input
            type="checkbox"
            data-panel-show-labels
            checked={panel.showLabels}
            onChange={(e) => onUpdate({ showLabels: e.target.checked })}
            title="Write each category's name at its cells' median position"
          />
          <span style={{ ...labelStyle, marginLeft: '2px' }}>on plot</span>
          <NumberInput
            data-panel-label-size
            min={6}
            max={40}
            step={1}
            value={panel.labelFontSize}
            disabled={!panel.showLabels}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v >= 6 && v <= 40) onUpdate({ labelFontSize: v })
            }}
            style={{ ...inputStyle, flex: 'none', width: '52px', marginLeft: 'auto' }}
            title="Label font size (px)"
          />
          <span style={labelStyle}>px</span>
        </ControlRow>
      )}

      <div style={{ height: '1px', backgroundColor: '#333', margin: '12px 0' }} />

      <ControlRow label="Background">
        <input
          type="color"
          value={panel.background}
          onChange={(e) => onUpdate({ background: e.target.value })}
          style={colorInputStyle}
        />
      </ControlRow>
      <ControlRow label="Border">
        <input
          type="checkbox"
          checked={panel.showBorder}
          onChange={(e) => onUpdate({ showBorder: e.target.checked })}
        />
      </ControlRow>
      <ControlRow label="Overlay">
        <input
          type="checkbox"
          data-panel-show-overlay
          checked={panel.showHighlightOverlay}
          onChange={(e) => onUpdate({ showHighlightOverlay: e.target.checked })}
          title="Draw the figure's overlay (below) on this panel"
        />
        <span style={{ ...labelStyle, marginLeft: '4px' }}>show on this panel</span>
      </ControlRow>
    </div>
  )
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
      <span style={{ ...labelStyle, width: '70px', flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  )
}

const containerStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  width: '100%',
  minWidth: 0,
  height: '100%',
  backgroundColor: '#0f1625',
}

// Wraps rather than widening the pane: with both side panes open the
// controls do not fit on one line, and a non-wrapping row pushed the panel
// grid off the left edge.
const toolbarStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: '6px',
  padding: '8px 12px',
  borderBottom: '1px solid #1a1a2e',
  backgroundColor: '#16213e',
}

const bodyStyle = {
  flex: 1,
  display: 'flex',
  minHeight: 0,
  overflow: 'hidden',
}

const sidebarStyle = {
  width: '280px',
  borderLeft: '1px solid #1a1a2e',
  backgroundColor: '#16213e',
  padding: '12px',
  overflowY: 'auto' as const,
  flexShrink: 0,
}

const footerStyle = {
  padding: '4px 12px',
  fontSize: '10px',
  color: '#666',
  borderTop: '1px solid #1a1a2e',
  backgroundColor: '#16213e',
}

const emptyStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  backgroundColor: '#0f1625',
  padding: '32px',
}

const labelStyle = { fontSize: '11px', color: '#888' }
const sectionHeadStyle = { fontSize: '12px', fontWeight: 600, color: '#aaa', textTransform: 'uppercase' as const, marginBottom: '8px' }
const noticeStyle = {
  fontSize: '11px',
  color: '#ddd',
  backgroundColor: 'rgba(233, 162, 59, 0.12)',
  border: '1px solid #e9a23b',
  borderRadius: '4px',
  padding: '8px',
  marginBottom: '10px',
  lineHeight: 1.4,
}
const iconButtonStyle = {
  padding: '0 6px',
  fontSize: '13px',
  lineHeight: '16px',
  backgroundColor: 'transparent',
  color: '#aaa',
  border: '1px solid #444',
  borderRadius: '3px',
  cursor: 'pointer',
}
const hintStyle = { fontSize: '10px', color: '#888', marginBottom: '6px', marginLeft: '76px' }

const inputStyle = {
  flex: 1,
  minWidth: 0,
  padding: '4px 6px',
  fontSize: '11px',
  backgroundColor: '#1a1a2e',
  color: '#eee',
  border: '1px solid #0f3460',
  borderRadius: '3px',
}

const titleInputStyle = {
  ...inputStyle,
  flex: 'none' as const,
  width: '180px',
}

const selectStyle = {
  ...inputStyle,
  flex: 'none' as const,
  cursor: 'pointer',
}

const colorInputStyle = {
  width: '28px',
  height: '22px',
  padding: 0,
  border: '1px solid #0f3460',
  borderRadius: '3px',
  backgroundColor: '#1a1a2e',
  cursor: 'pointer',
}

const primaryButtonStyle = {
  whiteSpace: 'nowrap' as const,
  padding: '4px 12px',
  fontSize: '12px',
  fontWeight: 500,
  backgroundColor: '#4ecdc4',
  color: '#000',
  border: 'none',
  borderRadius: '3px',
  cursor: 'pointer',
}

const secondaryButtonStyle = {
  whiteSpace: 'nowrap' as const,
  padding: '4px 12px',
  fontSize: '12px',
  backgroundColor: 'transparent',
  color: '#aaa',
  border: '1px solid #444',
  borderRadius: '3px',
  cursor: 'pointer',
}
