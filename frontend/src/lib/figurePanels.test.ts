import { describe, expect, it } from 'vitest'
import { defaultDisplayPreferences, type HighlightLayer } from '../store'
import {
  SPEC_NONE, autoPanelTitle, categoryCentroids, editableHighlightLayers, panelRequest, panelRouteTarget,
  specForBivariate, specForColumn, specForGenes, specForScore,
} from './figurePanels'

const fig = (slot: string, activePanelId: string | null, ids: string[], overlayLayers: HighlightLayer[] = []) => ({
  slot, activePanelId, panels: ids.map((id) => ({ id })), overlayLayers,
})
const layer = (id: string): HighlightLayer => ({ id, color: '#fff', intensity: 1, source: { kind: 'cellset', label: id, mask: new Uint8Array(1) } })

describe('panelRouteTarget', () => {
  const base = { centerPanelView: 'figure', activeSlot: 'primary', highlightLayers: [] as HighlightLayer[] }
  it('names the active panel, or the first when none or a stale one is active', () => {
    expect(panelRouteTarget({ ...base, activeFigure: fig('primary', null, ['p1', 'p2']) })).toBe('p1')
    expect(panelRouteTarget({ ...base, activeFigure: fig('primary', 'p2', ['p1', 'p2']) })).toBe('p2')
    expect(panelRouteTarget({ ...base, activeFigure: fig('primary', 'gone', ['p1']) })).toBe('p1')
  })
  it('routes nothing off the Panels tab, without a figure, or on another dataset', () => {
    expect(panelRouteTarget({ ...base, centerPanelView: 'scatter', activeFigure: fig('primary', null, ['p1']) })).toBeNull()
    expect(panelRouteTarget({ ...base, activeFigure: null })).toBeNull()
    expect(panelRouteTarget({ ...base, activeSlot: 'secondary', activeFigure: fig('primary', null, ['p1']) })).toBeNull()
  })
})

describe('editableHighlightLayers', () => {
  it("is the figure's overlay while Panels routes, else the dataset's layers", () => {
    const state = { centerPanelView: 'figure', activeSlot: 'primary', highlightLayers: [layer('ds')], activeFigure: fig('primary', null, ['p1'], [layer('fig')]) }
    expect(editableHighlightLayers(state).map((l) => l.id)).toEqual(['fig'])
    expect(editableHighlightLayers({ ...state, centerPanelView: 'scatter' }).map((l) => l.id)).toEqual(['ds'])
  })
})

describe('autoPanelTitle', () => {
  it('names the colouring', () => {
    expect(autoPanelTitle(specForGenes(['Myl7']))).toBe('Myl7')
    expect(autoPanelTitle(specForGenes(['A', 'B'], 'cardio'))).toBe('cardio')
    expect(autoPanelTitle(specForGenes(['A', 'B', 'C']))).toBe('3 genes')
    expect(autoPanelTitle(specForColumn('celltype'))).toBe('celltype')
    expect(autoPanelTitle(specForScore('X_ucell', 'Hox'))).toBe('Hox')
    expect(autoPanelTitle(specForBivariate(['A'], ['B', 'C'], undefined, 'setB'))).toBe('A vs setB')
    expect(autoPanelTitle(specForBivariate(['A', 'B'], ['C']))).toBe('2 genes vs C')
    expect(autoPanelTitle(SPEC_NONE)).toBe('')
    expect(autoPanelTitle(specForColumn(null))).toBe('')
  })
})

describe('panelRequest', () => {
  const prefs = { ...defaultDisplayPreferences(), expressionTransform: 'log1p' as const, clipPercentile: 1 }
  it('a gene is fetched as Display fetches it', () => {
    expect(panelRequest(specForGenes(['Myl7']), prefs, null)!.url).toBe('/api/expression/Myl7?transform=log1p&clip_percentile=1')
    const plain = { ...defaultDisplayPreferences(), clipPercentile: 0 }
    expect(panelRequest(specForGenes(['Nkx2-5']), plain, 'X')!.url).toBe('/api/expression/Nkx2-5')
    expect(panelRequest(specForGenes(['A/B']), plain, 'counts')!.url).toBe('/api/expression/A%2FB?layer=counts')
  })
  it('a set uses the per-gene pipeline, or UCell with its down genes', () => {
    const multi = panelRequest(specForGenes(['A', 'B'], 's'), prefs, 'counts')!
    expect(multi.url).toBe('/api/expression/multi')
    expect(JSON.parse(multi.init!.body as string)).toMatchObject({
      genes: ['A', 'B'], transform: 'log1p', per_gene_norm: prefs.geneSetPerGeneNorm, per_gene_clip: prefs.geneSetPerGeneClip,
      aggregation: prefs.geneSetAggregation, clip_percentile: 1, layer: 'counts',
    })
    const ucell = panelRequest(specForGenes(['A'], 's', ['D']), { ...prefs, geneSetScoringMethod: 'ucell' }, null)!
    expect(ucell.url).toBe('/api/expression/ucell')
    expect(JSON.parse(ucell.init!.body as string)).toEqual({ up: ['A'], down: ['D'], layer: 'counts' })
  })
  it('columns, scores and bivariate colourings', () => {
    expect(panelRequest(specForColumn('celltype'), prefs, null)!.url).toBe('/api/obs/celltype')
    const score = panelRequest(specForScore('X_s', 'c1'), prefs, null)!
    expect(score.url).toBe('/api/obsm/column')
    expect(JSON.parse(score.init!.body as string)).toEqual({ obsm_name: 'X_s', column: 'c1' })
    const biv = panelRequest(specForBivariate(['A'], ['B']), prefs, null)!
    expect(biv.url).toBe('/api/expression/bivariate')
    expect(JSON.parse(biv.init!.body as string)).toMatchObject({ genes1: ['A'], genes2: ['B'], transform: 'log1p', clip_percentile: 1 })
    expect(panelRequest(SPEC_NONE, prefs, null)).toBeNull()
    expect(panelRequest(specForGenes([]), prefs, null)).toBeNull()
  })
})

describe('categoryCentroids', () => {
  it('takes each category\'s median position and skips unassigned', () => {
    expect(categoryCentroids([[0, 0], [2, 0], [10, 10], [11, 11], [5, 5]], [0, 0, 1, 1, 2], ['a', 'b', 'unassigned'])).toEqual([
      { label: 'a', x: 1, y: 0, n: 2 }, { label: 'b', x: 10.5, y: 10.5, n: 2 },
    ])
  })
  it('pairs coordinates with values through the figure\'s cell indices', () => {
    // coords are the figure's cells 2 and 0; values are per dataset cell
    expect(categoryCentroids([[4, 4], [8, 8]], [1, 9, 0], ['a', 'b'], [2, 0])).toEqual([
      { label: 'a', x: 4, y: 4, n: 1 }, { label: 'b', x: 8, y: 8, n: 1 },
    ])
  })
  it('string values and nulls', () => {
    expect(categoryCentroids([[0, 0], [1, 1], [2, 2]], ['x', null, 'nan'], [])).toEqual([{ label: 'x', x: 0, y: 0, n: 1 }])
  })
})
