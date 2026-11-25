/** The Panels tab's rules, kept pure so they can be tested and shared by the
 *  store, the colour actions in `useData` and the panel renderer.
 *
 *  While Panels is showing a figure made on the active dataset, the Genes and
 *  Cells panes colour the figure's active panel instead of the Embedding tab,
 *  and the highlight tools edit the figure's overlay instead of the dataset's
 *  (`panelRouteTarget`, `editableHighlightLayers`). A panel's colouring is a
 *  spec (`PanelColorSpec`) fetched the way Display fetches the same thing
 *  (`panelRequest`), and titled after it (`autoPanelTitle`). */
import type { DisplayPreferences, HighlightLayer } from '../store'

export type PanelColorMode = 'none' | 'expression' | 'metadata' | 'bivariate' | 'score'

export interface PanelColorSpec {
  colorMode: PanelColorMode
  selectedGenes: string[]
  selectedGeneSetName: string | null
  genesDown: string[]
  selectedColorColumn: string | null
  scoreSource: { obsm: string; column: string } | null
  /** The sidebar picker's own choices, kept so it can show them. */
  bivariateSet1: string | null
  bivariateSet2: string | null
  bivariateGene1: string | null
  bivariateGene2: string | null
  /** What a bivariate panel is scored on, and what each axis is called. */
  bivariateGenes1: string[] | null
  bivariateGenes2: string[] | null
  bivariateLabel1: string | null
  bivariateLabel2: string | null
}

export const SPEC_NONE: PanelColorSpec = {
  colorMode: 'none', selectedGenes: [], selectedGeneSetName: null, genesDown: [], selectedColorColumn: null,
  scoreSource: null, bivariateSet1: null, bivariateSet2: null, bivariateGene1: null, bivariateGene2: null,
  bivariateGenes1: null, bivariateGenes2: null, bivariateLabel1: null, bivariateLabel2: null,
}

export function specForGenes(genes: string[], setName: string | null = null, genesDown: string[] = []): PanelColorSpec {
  return { ...SPEC_NONE, colorMode: 'expression', selectedGenes: [...genes], selectedGeneSetName: setName, genesDown: [...genesDown] }
}

export function specForColumn(column: string | null): PanelColorSpec {
  return column ? { ...SPEC_NONE, colorMode: 'metadata', selectedColorColumn: column } : SPEC_NONE
}

export function specForScore(obsm: string, column: string): PanelColorSpec {
  return { ...SPEC_NONE, colorMode: 'score', scoreSource: { obsm, column } }
}

export function specForBivariate(genes1: string[], genes2: string[], label1: string | null = null,
  label2: string | null = null): PanelColorSpec {
  return {
    ...SPEC_NONE, colorMode: 'bivariate', bivariateGenes1: [...genes1], bivariateGenes2: [...genes2],
    bivariateLabel1: label1, bivariateLabel2: label2,
  }
}

function genesName(genes: readonly string[]): string {
  return genes.length === 1 ? genes[0] : `${genes.length} genes`
}

/** The title a panel gets from its colouring: the gene, set, column or score
 *  column, or "A vs B" for a bivariate panel; empty when uncoloured. */
export function autoPanelTitle(p: PanelColorSpec): string {
  switch (p.colorMode) {
    case 'expression':
      return p.selectedGenes.length === 0 ? '' : (p.selectedGeneSetName ?? genesName(p.selectedGenes))
    case 'metadata':
      return p.selectedColorColumn ?? ''
    case 'score':
      return p.scoreSource?.column ?? ''
    case 'bivariate': {
      const g1 = p.bivariateGenes1 ?? [], g2 = p.bivariateGenes2 ?? []
      if (!g1.length || !g2.length) return ''
      return `${p.bivariateLabel1 ?? genesName(g1)} vs ${p.bivariateLabel2 ?? genesName(g2)}`
    }
    default:
      return ''
  }
}

interface RouteState {
  centerPanelView: string
  activeSlot: string
  highlightLayers?: HighlightLayer[]
  activeFigure: { slot: string; activePanelId: string | null; panels: { id: string }[]; overlayLayers?: HighlightLayer[] } | null
}

/** The panel the panes colour right now, or null when they colour the
 *  Embedding: not on Panels, no figure, or a figure of another dataset. */
export function panelRouteTarget(s: RouteState): string | null {
  const fig = s.activeFigure
  if (s.centerPanelView !== 'figure' || !fig || fig.slot !== s.activeSlot || fig.panels.length === 0) return null
  return (fig.panels.find((p) => p.id === fig.activePanelId) ?? fig.panels[0]).id
}

const NO_LAYERS: HighlightLayer[] = []

/** The highlight layers the Genes pane edits: the figure's overlay while the
 *  panes colour a panel, else the dataset's. Returns stored arrays, so it is
 *  safe as a store selector. */
export function editableHighlightLayers(s: RouteState): HighlightLayer[] {
  if (panelRouteTarget(s)) return s.activeFigure?.overlayLayers ?? NO_LAYERS
  return s.highlightLayers ?? NO_LAYERS
}

function layerArg(layer: string | null): string | undefined {
  return layer && layer !== 'X' ? layer : undefined
}

function jsonPost(url: string, body: Record<string, unknown>): { url: string; init: RequestInit } {
  return { url, init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } }
}

/** The request that colours a panel, mirroring `useDataActions`: a gene by
 *  GET with Display's transform, clip and layer; a set through the per-gene
 *  pipeline, or UCell (with its down genes) when Display scores sets that
 *  way. The URL has no dataset: the caller adds the figure's slot. */
export function panelRequest(p: PanelColorSpec, prefs: DisplayPreferences, layer: string | null): { url: string; init?: RequestInit } | null {
  const transform = prefs.expressionTransform === 'log1p' ? 'log1p' : undefined
  const pipeline = {
    transform,
    per_gene_norm: prefs.geneSetPerGeneNorm,
    per_gene_clip: prefs.geneSetPerGeneClip,
    aggregation: prefs.geneSetAggregation,
    clip_percentile: prefs.clipPercentile,
    layer: layerArg(layer),
  }
  if (p.colorMode === 'expression') {
    const genes = p.selectedGenes
    if (genes.length === 0) return null
    const isSet = p.selectedGeneSetName !== null || genes.length > 1 || p.genesDown.length > 0
    if (isSet && prefs.geneSetScoringMethod === 'ucell') {
      return jsonPost('/api/expression/ucell', { up: genes, down: p.genesDown, layer: 'counts' })
    }
    if (genes.length === 1) {
      const qs = new URLSearchParams()
      if (transform) qs.set('transform', transform)
      if (prefs.clipPercentile > 0) qs.set('clip_percentile', String(prefs.clipPercentile))
      const l = layerArg(layer)
      if (l) qs.set('layer', l)
      const q = qs.toString()
      return { url: `/api/expression/${encodeURIComponent(genes[0])}${q ? `?${q}` : ''}` }
    }
    return jsonPost('/api/expression/multi', { genes, ...pipeline })
  }
  if (p.colorMode === 'metadata' && p.selectedColorColumn) {
    return { url: `/api/obs/${encodeURIComponent(p.selectedColorColumn)}` }
  }
  if (p.colorMode === 'score' && p.scoreSource) {
    return jsonPost('/api/obsm/column', { obsm_name: p.scoreSource.obsm, column: p.scoreSource.column })
  }
  if (p.colorMode === 'bivariate' && p.bivariateGenes1?.length && p.bivariateGenes2?.length) {
    return jsonPost('/api/expression/bivariate', { genes1: p.bivariateGenes1, genes2: p.bivariateGenes2, ...pipeline })
  }
  return null
}

const NOT_A_GROUP = new Set(['unassigned', 'nan', 'NaN'])

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Where each category's label sits: the median position of its cells
 *  (robust to stragglers), skipping unassigned and NaN labels and cells
 *  without coordinates. `values` holds one
 *  entry per dataset cell (a code into `categories`, or the label itself);
 *  `index`, when given, says which dataset cell `coords[i]` is. */
export function categoryCentroids(coords: readonly [number, number][], values: readonly (number | string | null | undefined)[],
  categories: readonly string[], index?: readonly number[]): { label: string; x: number; y: number; n: number }[] {
  const xs = new Map<string, number[]>()
  const ys = new Map<string, number[]>()
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue
    const v = values[index ? index[i] : i]
    if (v === null || v === undefined) continue
    const name = typeof v === 'number' ? (categories[v] ?? String(v)) : String(v)
    if (NOT_A_GROUP.has(name)) continue
    if (!xs.has(name)) { xs.set(name, []); ys.set(name, []) }
    xs.get(name)!.push(c[0])
    ys.get(name)!.push(c[1])
  }
  return [...xs.keys()].map((label) => ({ label, x: median(xs.get(label)!), y: median(ys.get(label)!), n: xs.get(label)!.length }))
}
