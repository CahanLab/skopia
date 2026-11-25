import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer } from '@deck.gl/layers'
import { OrthographicView, OrthographicViewState } from '@deck.gl/core'
import { Figure, FigurePanel as PanelType, HighlightLayer, HighlightSource, useStore, type DisplayPreferences } from '../store'
import { appendDataset, fetchJson } from '../hooks/useData'
import { categoryCentroids, panelRequest } from '../lib/figurePanels'
import { layoutLabels } from '../lib/labelLayout'
import { viewTransform } from '../lib/textAnnotations'
import { figureInk } from '../lib/figures'
import { boundsOf, fitView, zoomLimits } from '../lib/viewFit'
import { getColorFromScale, getBivariateColor, resolveCategoryPalette, hexToRgb } from '../lib/cellColors'
import TextAnnotationOverlay from './TextAnnotationOverlay'
import { numericExtent } from '../lib/numericExtent'

// Build a per-cell weight function for a HighlightLayer. Mirrors the
// `layerWeightFn` in ScatterPlot.tsx (kept inline here to avoid leaking
// internals; small enough that duplication is fine).
function layerWeightFn(layer: HighlightLayer): (i: number) => number {
  const src: HighlightSource = layer.source
  const intensity = layer.intensity
  if (src.kind === 'cellset') {
    const mask = src.mask
    return (i: number) => (mask[i] ? intensity : 0)
  }
  const { values, thresholdMode, lo, hi } = src
  if (thresholdMode === 'above') {
    return (i: number) => {
      const v = values[i]
      return v != null && v >= lo ? intensity : 0
    }
  }
  if (thresholdMode === 'below') {
    return (i: number) => {
      const v = values[i]
      return v != null && v <= lo ? intensity : 0
    }
  }
  return (i: number) => {
    const v = values[i]
    return v != null && v >= lo && v <= hi ? intensity : 0
  }
}

// Per-panel color data — fetched lazily based on the panel's color mode.
interface PanelColorData {
  kind: 'expression' | 'metadata-numeric' | 'metadata-category' | 'bivariate' | 'none'
  values?: (number | null)[]                    // length = current n_cells
  values1?: number[]                            // bivariate: gene-set 1 score (normalized [0,1])
  values2?: number[]                            // bivariate: gene-set 2 score (normalized [0,1])
  min?: number
  max?: number
  categories?: string[]
  categoryColors?: (string | null | undefined)[]
}

interface ColorResponse {
  values?: (number | null)[]
  min?: number
  max?: number
  dtype?: string
  categories?: string[]
  colors?: (string | null)[]
  values1?: number[]
  values2?: number[]
}

/** Fetch a panel's colouring from the figure's dataset, as Display would
 *  compute it there (lib/figurePanels.panelRequest). */
async function fetchPanelData(panel: PanelType, prefs: DisplayPreferences, layer: string, slot: string): Promise<PanelColorData> {
  const req = panelRequest(panel, prefs, layer)
  if (!req) return { kind: 'none' }
  const data = await fetchJson<ColorResponse>(appendDataset(req.url, slot), req.init)
  if (panel.colorMode === 'bivariate') return { kind: 'bivariate', values1: data.values1, values2: data.values2 }
  if (panel.colorMode === 'metadata') {
    if (data.dtype === 'category') {
      return { kind: 'metadata-category', values: data.values, categories: data.categories ?? [], categoryColors: data.colors ?? undefined }
    }
    if (data.dtype === 'numeric' && data.values) {
      const { min, max } = numericExtent(data.values)
      return { kind: 'metadata-numeric', values: data.values, min, max }
    }
    return { kind: 'none' }
  }
  return { kind: 'expression', values: data.values, min: data.min, max: data.max }
}

interface Props {
  figure: Figure
  panel: PanelType
  // Render-only mode used by the export path — disables interaction so the
  // panel renders without controllers, suitable for screenshot capture.
  staticView?: boolean
  /** The panel the Genes and Cells panes colour; it offers its title for naming. */
  isActive?: boolean
}

export default function FigurePanel({ figure, panel, staticView = false, isActive = false }: Props) {
  const updateFigure = useStore((s) => s.updateFigure)
  const setFigurePanelTitle = useStore((s) => s.setFigurePanelTitle)
  const highlightLayers = figure.overlayLayers
  // Display settings of the dataset the figure was made on, so a panel keeps
  // computing its colours there when another dataset is active.
  const prefs = useStore((s) => s.datasets[figure.slot]?.displayPreferences ?? s.displayPreferences)
  const displayLayer = useStore((s) => s.datasets[figure.slot]?.displayLayer ?? 'X')
  const [colorData, setColorData] = useState<PanelColorData>({ kind: 'none' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Refetch only when the request itself changes, not on every panel edit
  // (a title or a colour scale leaves it alone).
  const request = panelRequest(panel, prefs, displayLayer)
  const requestKey = request ? `${figure.slot}|${request.url}|${String(request.init?.body ?? '')}` : ''
  const latest = useRef({ panel, prefs, displayLayer })
  latest.current = { panel, prefs, displayLayer }

  useEffect(() => {
    let cancelled = false
    setError(null)
    if (!requestKey) {
      setColorData({ kind: 'none' })
      setLoading(false)
      return
    }
    setLoading(true)
    const { panel: p, prefs: dp, displayLayer: dl } = latest.current
    fetchPanelData(p, dp, dl, figure.slot)
      .then((d) => {
        if (!cancelled) setColorData(d)
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [requestKey, figure.slot])

  // Bounds from the snapshotted coordinates — used for default viewState.
  const bounds = useMemo(() => boundsOf(figure.coordinates), [figure.coordinates])

  // Build deck.gl data — each entry is a renderable cell with position + the
  // ORIGINAL adata cell index (for color lookup) preserved. When the panel has
  // a continuous color source (expression or numeric metadata), stable-sort
  // ascending by the cell's score so high-value cells render LAST (= on top
  // in deck.gl draw order), matching the main ScatterPlot's behavior. This
  // keeps high-expression markers from being occluded by overlapping
  // low-expression cells.
  const data = useMemo(() => {
    let arr = figure.coordinates.map((coord, i) => ({
      position: coord,
      adataIndex: figure.cellIndices[i],
    }))
    if ((colorData.kind === 'expression' || colorData.kind === 'metadata-numeric') && colorData.values) {
      const values = colorData.values
      arr = [...arr].sort((a, b) => {
        const va = values[a.adataIndex] ?? -Infinity
        const vb = values[b.adataIndex] ?? -Infinity
        return (va as number) - (vb as number)
      })
    } else if (colorData.kind === 'bivariate' && colorData.values1 && colorData.values2) {
      // Sort by sum of normalized scores — matches the main ScatterPlot's
      // bivariate stacking so high-expression cells stay on top.
      const v1 = colorData.values1
      const v2 = colorData.values2
      arr = [...arr].sort((a, b) => {
        const sa = (v1[a.adataIndex] ?? 0) + (v2[a.adataIndex] ?? 0)
        const sb = (v1[b.adataIndex] ?? 0) + (v2[b.adataIndex] ?? 0)
        return sa - sb
      })
    }

    // Highlight overlay: after any expression/bivariate stacking, stable-sort
    // ascending by max highlight weight so highlighted cells end up LAST (= on
    // top in deck.gl draw order). Without this, an overlapping non-highlighted
    // low/zero-expression cell can be drawn over a highlighted cell and obscure
    // its color. Mirrors the main ScatterPlot's highlight stacking. The sort is
    // stable, so high-expression-on-top is preserved among equal-weight cells.
    if (panel.showHighlightOverlay && highlightLayers.length > 0) {
      const weighters = highlightLayers.map(layerWeightFn)
      const weightAt = (i: number): number => {
        let m = 0
        for (let k = 0; k < weighters.length; k++) {
          const w = weighters[k](i)
          if (w > m) m = w
        }
        return m
      }
      arr = [...arr].sort((a, b) => weightAt(a.adataIndex) - weightAt(b.adataIndex))
    }
    return arr
  }, [figure.coordinates, figure.cellIndices, colorData, panel.showHighlightOverlay, highlightLayers])

  // Color function — closed over the panel's settings + fetched data.
  // When `showHighlightOverlay` is on, the dataset's `highlightLayers`
  // are blended on top of the base color in creation order (same hard-gate
  // blend formula used by the main ScatterPlot).
  const getColor = useMemo(() => {
    const opacity = Math.round(figure.pointOpacity * 255)
    const fallback: [number, number, number, number] = [100, 149, 237, opacity]

    // Compute baseColorFn first.
    let baseColorFn: (d: { adataIndex: number }) => [number, number, number, number]

    if (colorData.kind === 'expression' && colorData.values && colorData.min !== undefined && colorData.max !== undefined) {
      const { values, min, max } = colorData
      const range = max - min || 1
      const scale = panel.colorScale
      baseColorFn = (d: { adataIndex: number }): [number, number, number, number] => {
        const v = values[d.adataIndex]
        if (v == null) return [128, 128, 128, Math.round(opacity * 0.5)]
        const t = (v - min) / range
        const rgb = getColorFromScale(t, scale)
        return [rgb[0], rgb[1], rgb[2], opacity]
      }
    } else if (colorData.kind === 'metadata-numeric' && colorData.values && colorData.min !== undefined && colorData.max !== undefined) {
      const { values, min, max } = colorData
      const range = max - min || 1
      const scale = panel.colorScale
      baseColorFn = (d: { adataIndex: number }): [number, number, number, number] => {
        const v = values[d.adataIndex]
        if (v == null) return [128, 128, 128, Math.round(opacity * 0.5)]
        const t = ((v as number) - min) / range
        const rgb = getColorFromScale(t, scale)
        return [rgb[0], rgb[1], rgb[2], opacity]
      }
    } else if (colorData.kind === 'metadata-category' && colorData.values && colorData.categories) {
      const palette = resolveCategoryPalette(colorData.categories.length, colorData.categoryColors)
      const values = colorData.values
      baseColorFn = (d: { adataIndex: number }): [number, number, number, number] => {
        const v = values[d.adataIndex] as number
        const rgb = palette[v] ?? palette[0] ?? [128, 128, 128]
        return [rgb[0], rgb[1], rgb[2], opacity]
      }
    } else if (colorData.kind === 'bivariate' && colorData.values1 && colorData.values2) {
      const v1 = colorData.values1
      const v2 = colorData.values2
      const colormap = panel.bivariateColormap
      baseColorFn = (d: { adataIndex: number }): [number, number, number, number] => {
        const u = v1[d.adataIndex] ?? 0
        const w = v2[d.adataIndex] ?? 0
        const rgb = getBivariateColor(u, w, colormap)
        return [rgb[0], rgb[1], rgb[2], opacity]
      }
    } else {
      baseColorFn = (_d: { adataIndex: number }) => fallback
    }

    // Highlight overlay: blend each layer's color over the base color in
    // creation order. Per-cell weight is hard-gated (in-threshold = intensity,
    // else 0) for geneset layers and a mask lookup for cellset layers.
    if (panel.showHighlightOverlay && highlightLayers.length > 0) {
      const compiled = highlightLayers.map((layer) => ({
        rgb: hexToRgb(layer.color) ?? [34, 197, 94] as [number, number, number],
        weight: layerWeightFn(layer),
      }))
      const fn = baseColorFn
      return (d: { adataIndex: number }): [number, number, number, number] => {
        const base = fn(d)
        let r = base[0], g = base[1], b = base[2]
        for (let k = 0; k < compiled.length; k++) {
          const w = compiled[k].weight(d.adataIndex)
          if (w <= 0) continue
          const ww = w > 1 ? 1 : w
          const lr = compiled[k].rgb
          r = r * (1 - ww) + lr[0] * ww
          g = g * (1 - ww) + lr[1] * ww
          b = b * (1 - ww) + lr[2] * ww
        }
        return [Math.round(r), Math.round(g), Math.round(b), base[3]]
      }
    }

    return baseColorFn
  }, [colorData, panel.colorScale, panel.bivariateColormap, panel.showHighlightOverlay, highlightLayers, figure.pointOpacity])

  // Shared viewState: read from figure, write back when user pans/zooms.
  const viewState: OrthographicViewState = useMemo(() => {
    // Lazy default: fit to bounds, for the typical figure-panel size (~400×400
    // logical px). The zoom limits follow the fit even under a shared zoom.
    const fit = fitView(bounds, 400, 400)
    if (figure.sharedZoom !== null && figure.sharedTargetX !== null && figure.sharedTargetY !== null) {
      return {
        target: [figure.sharedTargetX, figure.sharedTargetY, 0],
        zoom: figure.sharedZoom,
        ...zoomLimits(fit.zoom),
      } as OrthographicViewState
    }
    return fit as OrthographicViewState
  }, [figure.sharedZoom, figure.sharedTargetX, figure.sharedTargetY, bounds])

  // Initialize shared viewState on first render if it hasn't been set.
  useEffect(() => {
    if (figure.sharedZoom === null) {
      const v = viewState
      updateFigure({
        sharedZoom: typeof v.zoom === 'number' ? v.zoom : (v.zoom as number[])[0],
        sharedTargetX: (v.target as number[])[0],
        sharedTargetY: (v.target as number[])[1],
      })
    }
    // Only run when shared state is null on mount — subsequent changes are
    // user-driven through handleViewStateChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleViewStateChange = useCallback(
    (params: { viewState: OrthographicViewState }) => {
      const v = params.viewState
      const target = v.target as number[]
      const zoom = typeof v.zoom === 'number' ? v.zoom : (v.zoom as number[])[0]
      updateFigure({
        sharedZoom: zoom,
        sharedTargetX: target[0],
        sharedTargetY: target[1],
      })
    },
    [updateFigure]
  )

  // The Embedding tab draws `pointSize` as the radius; so do panels.
  const radius = figure.pointSize

  // Panel size, for placing category labels in screen space.
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  const viewTarget: [number, number] = [(viewState.target as number[])[0], (viewState.target as number[])[1]]
  const viewZoom = typeof viewState.zoom === 'number' ? viewState.zoom : (viewState.zoom as number[])[0]

  // Category labels at per-category median centroids over the figure's
  // cells, pushed apart as on the Embedding tab (lib/labelLayout).
  const centroids = useMemo(() => {
    if (!panel.showLabels || colorData.kind !== 'metadata-category' || !colorData.values || !colorData.categories) return []
    return categoryCentroids(figure.coordinates, colorData.values, colorData.categories, figure.cellIndices)
  }, [panel.showLabels, colorData, figure.coordinates, figure.cellIndices])
  const placedLabels = useMemo(() => {
    if (centroids.length === 0 || size.w === 0 || size.h === 0) return []
    const t = viewTransform(viewTarget, viewZoom, size.w, size.h)
    const anchors = centroids.map((c) => {
      const [x, y] = t.toScreen(c.x, c.y)
      return { id: c.label, text: c.label, x, y, weight: c.n }
    })
    return layoutLabels(anchors, { fontPx: panel.labelFontSize, bounds: { w: size.w, h: size.h } }).filter((p) => !p.hidden)
    // viewTarget is rebuilt each render; its numbers are the dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centroids, viewTarget[0], viewTarget[1], viewZoom, size.w, size.h, panel.labelFontSize])

  // Inline title editing: click the title, Enter or click away to keep it,
  // Escape to drop the edit. A blank title returns to the automatic one.
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const editingRef = useRef(false)
  const beginTitleEdit = () => {
    if (staticView) return
    setTitleDraft(panel.title)
    editingRef.current = true
    setEditingTitle(true)
  }
  const endTitleEdit = (keep: boolean) => {
    if (!editingRef.current) return
    editingRef.current = false
    setEditingTitle(false)
    if (keep && titleDraft !== panel.title) setFigurePanelTitle(panel.id, titleDraft)
  }
  const ink = figureInk(panel.background)

  // Pack positions into a Float32Array binary attribute. See ScatterPlot.tsx
  // for the rationale — deck.gl 9.2.6's per-cell accessor path has a stride
  // bug at N ≳ 44k that produces a phantom vertical line at X=0.
  const positionsBuf = useMemo(() => {
    const buf = new Float32Array(data.length * 2)
    for (let i = 0; i < data.length; i++) {
      const p = data[i].position
      buf[i * 2] = p[0]
      buf[i * 2 + 1] = p[1]
    }
    return buf
  }, [data])

  const deckLayers = [
    new ScatterplotLayer({
      id: `panel-${panel.id}`,
      data: {
        length: data.length,
        attributes: {
          getPosition: { value: positionsBuf, size: 2 },
        },
      },
      getRadius: radius,
      getFillColor: (_obj: unknown, info: { index: number }) => getColor(data[info.index]),
      radiusUnits: 'pixels',
      radiusMinPixels: 1,
      stroked: false,
      filled: true,
      updateTriggers: {
        getFillColor: [colorData, panel.colorScale, panel.bivariateColormap, panel.showHighlightOverlay, highlightLayers, figure.pointOpacity],
        getRadius: figure.pointSize,
      },
    }),
  ]

  const view = useMemo(() => new OrthographicView({ id: `view-${panel.id}` }), [panel.id])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        backgroundColor: panel.background,
        border: panel.showBorder ? '1px solid #444' : 'none',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <DeckGL
        views={view}
        viewState={viewState}
        controller={!staticView}
        layers={deckLayers}
        useDevicePixels={true}
        onViewStateChange={staticView ? undefined : handleViewStateChange}
        style={{ width: '100%', height: '100%' }}
      />
      {figure.showGrid && (
        <GridOverlay
          divisions={figure.gridDivisions}
          color={figure.gridColor}
          lineWidth={figure.gridLineWidth}
        />
      )}
      {/* The embedding's text annotations, read-only, in this panel's view. */}
      <TextAnnotationOverlay
        slot={figure.slot}
        embeddingName={figure.embeddingName}
        dimX={figure.dimX ?? 0}
        dimY={figure.dimY ?? 1}
        target={viewTarget}
        zoom={viewZoom}
        active={false}
      />
      {placedLabels.length > 0 && (
        // Read by utils/exportFigure, which redraws these labels into the PNG.
        <svg data-panel-labels data-font-px={panel.labelFontSize} style={labelSvgStyle}>
          {placedLabels.map((c) => Math.hypot(c.x - c.ax, c.y - c.ay) > panel.labelFontSize * 0.6 && (
            <line key={`${c.id}-leader`} x1={c.ax} y1={c.ay} x2={c.x} y2={c.y} stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
          ))}
          {placedLabels.map((c) => (
            <text
              key={c.id}
              x={c.x}
              y={c.y}
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fontSize: panel.labelFontSize, fontWeight: 700, fill: '#fff', stroke: '#000', strokeWidth: 3.5, paintOrder: 'stroke' } as React.CSSProperties}
            >
              {c.text}
            </text>
          ))}
        </svg>
      )}
      {editingTitle ? (
        <input
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') endTitleEdit(true)
            if (e.key === 'Escape') endTitleEdit(false)
            e.stopPropagation()
          }}
          onBlur={() => endTitleEdit(true)}
          onPointerDown={(e) => e.stopPropagation()}
          placeholder="Blank = automatic title"
          data-panel-title-input
          style={titleInputStyle}
        />
      ) : (panel.title || (isActive && !staticView)) ? (
        <div
          data-panel-title
          onClick={beginTitleEdit}
          title={staticView ? undefined : 'Click to rename'}
          style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            fontSize: '14px',
            fontWeight: 600,
            color: panel.title ? ink.title : ink.muted,
            fontStyle: panel.title ? 'normal' : 'italic',
            cursor: staticView ? 'default' : 'text',
            pointerEvents: staticView ? 'none' : 'auto',
          }}
        >
          {panel.title || 'Click to name'}
        </div>
      ) : null}
      {/* Expression legend (mini colorbar) — only for continuous color modes */}
      {(colorData.kind === 'expression' || colorData.kind === 'metadata-numeric') &&
        colorData.min !== undefined && colorData.max !== undefined && (
        <div
          style={{
            position: 'absolute',
            right: '8px',
            bottom: '8px',
            pointerEvents: 'none',
            color: '#fff',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            fontSize: '10px',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span>{colorData.min.toFixed(2)}</span>
            <ColorBar scale={panel.colorScale} width={80} height={8} />
            <span>{colorData.max.toFixed(2)}</span>
          </div>
        </div>
      )}
      {loading && (
        <div style={loadingOverlayStyle}>Loading…</div>
      )}
      {error && (
        <div style={{ ...loadingOverlayStyle, color: '#e94560' }}>{error}</div>
      )}
    </div>
  )
}

// Screen-fixed N×N grid overlay (the same N lines regardless of zoom/pan).
// Drawn as an absolutely-positioned SVG that sits on top of the deck.gl
// canvas but ignores pointer events so pan/zoom still work.
function GridOverlay({ divisions, color, lineWidth }: { divisions: number; color: string; lineWidth: number }) {
  const lines: React.ReactElement[] = []
  for (let i = 1; i < divisions; i++) {
    const p = (i / divisions) * 100
    lines.push(
      <line key={`v${i}`} x1={`${p}%`} x2={`${p}%`} y1="0" y2="100%" stroke={color} strokeWidth={lineWidth} />
    )
    lines.push(
      <line key={`h${i}`} x1="0" x2="100%" y1={`${p}%`} y2={`${p}%`} stroke={color} strokeWidth={lineWidth} />
    )
  }
  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        shapeRendering: 'crispEdges',
        opacity: 0.6,
      }}
    >
      {lines}
    </svg>
  )
}

function ColorBar({ scale, width, height }: { scale: import('../store').ColorScale; width: number; height: number }) {
  // Render a horizontal gradient stripe sampled from the color scale.
  const stops: string[] = []
  const N = 16
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const rgb = getColorFromScale(t, scale)
    stops.push(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}) ${(t * 100).toFixed(0)}%`)
  }
  const bg = `linear-gradient(to right, ${stops.join(', ')})`
  return <div style={{ width, height, background: bg, borderRadius: '2px', border: '1px solid rgba(255,255,255,0.4)' }} />
}

const labelSvgStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  overflow: 'visible',
}

const titleInputStyle: React.CSSProperties = {
  position: 'absolute',
  top: '6px',
  left: '6px',
  width: '60%',
  fontSize: '14px',
  fontWeight: 600,
  padding: '1px 4px',
  background: '#0f1625',
  color: '#eee',
  border: '1px solid #4ecdc4',
  borderRadius: '3px',
  outline: 'none',
}

const loadingOverlayStyle = {
  position: 'absolute' as const,
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  padding: '6px 12px',
  backgroundColor: 'rgba(0,0,0,0.6)',
  color: '#fff',
  fontSize: '11px',
  borderRadius: '4px',
}
