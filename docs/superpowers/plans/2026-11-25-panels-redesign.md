# Panels Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Panels tab quick to use: no create step, panels coloured from the Genes and Cells panes, one figure-owned overlay, editable automatic titles, category labels.

**Architecture:** Pure helpers in `frontend/src/lib/figurePanels.ts` decide routing, colour specs, titles, fetch requests and centroids. The store's figure gains a slot, overlay layers and an active panel; colour and highlight actions route to the figure while Panels is showing. `FigureBuilder` / `FigurePanel` render from that.

**Tech Stack:** React 18 + Zustand + deck.gl, vitest. Frontend only; no backend change.

**Spec:** `docs/superpowers/specs/2026-11-25-panels-redesign-design.md`

## Global Constraints

- Inline styles, palette per CLAUDE.md (accent `#4ecdc4`, panel `#16213e`, field `#0f3460`).
- No `Math.min(...arr)` over per-cell arrays (`lib/numericExtent.ts`).
- Number fields are `components/NumberInput.tsx`.
- The Embedding tab's colour and highlight state must not change while Panels routes.
- Run frontend checks from `frontend/`: `npx tsc --noEmit`, `npx vitest run`.

## Review Focus

- Panels showing but the figure was made on another dataset slot: the panes colour the Embedding as before, nothing is written to the figure (Task 1 predicate test).
- A layout change that removes the active panel: the active panel falls back to the first (Task 2 store test).
- A gene the dataset lacks, clicked while Panels shows: the panel shows its fetch error, nothing else changes (Task 4, browser check).
- Clearing an edited title returns to the automatic one; recolouring an edited panel keeps the edited title (Task 2 store test).
- Highlight layers added in Panels never appear on the Embedding, and Embedding layers added before stay put (Task 2 store test).

---

### Task 1: Pure helpers (`lib/figurePanels.ts`)

**Files:**
- Create: `frontend/src/lib/figurePanels.ts`
- Test: `frontend/src/lib/figurePanels.test.ts`

**Interfaces:**
- Produces:
  - `panelRouteTarget(s: { centerPanelView: string; activeSlot: string; activeFigure: { slot: string; activePanelId: string | null; panels: { id: string }[] } | null }): string | null`: the panel id to colour, or null (not Panels, no figure, or slot mismatch). Active id falls back to the first panel when missing.
  - `editableHighlightLayers(s): HighlightLayer[]`: the figure's `overlayLayers` when `panelRouteTarget(s)` is non-null, else `s.highlightLayers`.
  - `PanelColorSpec = Pick<FigurePanel, 'colorMode' | 'selectedGenes' | 'selectedGeneSetName' | 'genesDown' | 'selectedColorColumn' | 'scoreSource' | 'bivariateSet1' | 'bivariateSet2' | 'bivariateGene1' | 'bivariateGene2' | 'bivariateGenes1' | 'bivariateGenes2' | 'bivariateLabel1' | 'bivariateLabel2'>`
  - `specForGenes(genes: string[], setName?: string | null, genesDown?: string[]): PanelColorSpec`, `specForColumn(column: string | null)`, `specForScore(obsm: string, column: string)`, `specForBivariate(g1: string[], g2: string[], l1?: string, l2?: string)`, `SPEC_NONE`.
  - `autoPanelTitle(p: PanelColorSpec): string`
  - `panelRequest(p, prefs: DisplayPreferences, layer: string | null): { url: string; init?: RequestInit } | null`: URL without dataset; caller applies `appendDataset(url, slot)`.
  - `categoryCentroids(coords: [number, number][], values: (number | string | null)[], categories: string[], index?: number[]): { label: string; x: number; y: number; n: number }[]`

- [ ] **Step 1: Write the failing tests**

```ts
// routing
expect(panelRouteTarget({ centerPanelView: 'figure', activeSlot: 'primary', activeFigure: fig('primary', null, ['p1','p2']) })).toBe('p1')
expect(panelRouteTarget({ ...same, activeFigure: fig('primary', 'p2', ['p1','p2']) })).toBe('p2')
expect(panelRouteTarget({ ...same, activeFigure: fig('primary', 'gone', ['p1']) })).toBe('p1')
expect(panelRouteTarget({ centerPanelView: 'scatter', ... })).toBeNull()
expect(panelRouteTarget({ ..., activeSlot: 'secondary' })).toBeNull()   // figure made on primary
expect(editableHighlightLayers(panelsState).map(l=>l.id)).toEqual(['fig-layer'])
expect(editableHighlightLayers(embeddingState).map(l=>l.id)).toEqual(['ds-layer'])
// titles
expect(autoPanelTitle(specForGenes(['Myl7']))).toBe('Myl7')
expect(autoPanelTitle(specForGenes(['A','B'], 'cardio'))).toBe('cardio')
expect(autoPanelTitle(specForGenes(['A','B','C']))).toBe('3 genes')
expect(autoPanelTitle(specForColumn('celltype'))).toBe('celltype')
expect(autoPanelTitle(specForScore('X_ucell', 'Hox'))).toBe('Hox')
expect(autoPanelTitle(specForBivariate(['A'], ['B','C'], undefined, 'setB'))).toBe('A vs setB')
expect(autoPanelTitle(SPEC_NONE)).toBe('')
// requests follow Display
const prefs = { ...defaultDisplayPreferences(), expressionTransform: 'log1p', clipPercentile: 1 }
expect(panelRequest(specForGenes(['Myl7']), prefs, null)!.url).toBe('/api/expression/Myl7?transform=log1p&clip_percentile=1')
const multi = panelRequest(specForGenes(['A','B'], 's'), prefs, 'counts')!
expect(multi.url).toBe('/api/expression/multi')
expect(JSON.parse(multi.init!.body as string)).toMatchObject({ genes: ['A','B'], transform: 'log1p', per_gene_norm: prefs.geneSetPerGeneNorm, aggregation: prefs.geneSetAggregation, clip_percentile: 1, layer: 'counts' })
const ucell = panelRequest(specForGenes(['A'], 's', ['D']), { ...prefs, geneSetScoringMethod: 'ucell' }, null)!
expect(ucell.url).toBe('/api/expression/ucell'); expect(JSON.parse(ucell.init!.body as string)).toEqual({ up: ['A'], down: ['D'], layer: 'counts' })
expect(panelRequest(specForColumn('celltype'), prefs, null)!.url).toBe('/api/obs/celltype')
expect(panelRequest(specForScore('X_s', 'c1'), prefs, null)!.url).toBe('/api/obsm/column')
expect(panelRequest(specForBivariate(['A'],['B']), prefs, null)!.url).toBe('/api/expression/bivariate')
expect(panelRequest(SPEC_NONE, prefs, null)).toBeNull()
// centroids: median, skips unassigned/nan, codes index categories, optional index subset
expect(categoryCentroids([[0,0],[2,0],[10,10],[11,11],[5,5]], [0,0,1,1,2], ['a','b','unassigned'])).toEqual([
  { label: 'a', x: 1, y: 0, n: 2 }, { label: 'b', x: 10.5, y: 10.5, n: 2 }])
```

- [ ] **Step 2: Run** `npx vitest run src/lib/figurePanels.test.ts`: FAIL (module missing).
- [ ] **Step 3: Implement** the module. A single gene with UCell off uses `GET /api/expression/{gene}` with `transform` (when log1p), `clip_percentile` (when > 0), `layer` (when not null/`X`), in that order; UCell applies to any set, as `colorByGenes` does. `categoryCentroids` takes `index` (the figure's `cellIndices`) so `coords[i]` pairs with `values[index[i]]`.
- [ ] **Step 4: Run** the test: PASS.
- [ ] **Step 5: Commit** `feat(panels): pure helpers for routing, colour specs, titles, requests, centroids`.

### Task 2: Store

**Files:**
- Modify: `frontend/src/store.ts` (types ~423-479, `createFigure` ~2995, figure actions ~3042-3096, highlight actions ~1694-1713)
- Test: `frontend/src/store.test.ts`

**Interfaces:**
- Consumes: Task 1 `panelRouteTarget`, `autoPanelTitle`, `PanelColorSpec`, `SPEC_NONE`.
- Produces:
  - `FigurePanel` adds `titleEdited: boolean`, `genesDown?: string[]`, `scoreSource?: { obsm: string; column: string } | null`, `bivariateGenes1?/2?: string[] | null`, `bivariateLabel1?/2?: string | null`, `showLabels: boolean`, `labelFontSize: number`; colorMode adds `'score'`; `expressionTransform` removed.
  - `Figure` adds `slot: string`, `overlayLayers: HighlightLayer[]`, `activePanelId: string | null`.
  - `createFigure(cellIndices, coordinates, embeddingName, rows?, cols?, dims?)` unchanged signature; records `slot: activeSlot`, background / pointSize / pointOpacity / colorScale / labelFontSize from current `displayPreferences`, panels `showHighlightOverlay: true`, `title: ''`, `titleEdited: false`.
  - `colorFigurePanel(panelId: string, spec: PanelColorSpec): void`: applies the spec; sets `title = autoPanelTitle(spec)` unless `titleEdited`.
  - `setFigurePanelTitle(panelId: string, title: string): void`: trimmed empty → automatic title, `titleEdited: false`; else `titleEdited: true`.
  - `setActiveFigurePanel(panelId: string | null): void`
  - `cropFigure(cellIndices: number[], coordinates: [number, number][]): void`: replaces cells and coordinates, resets shared zoom to null, keeps panels.
  - `setFigureLayout` keeps `activePanelId` only if that panel survives.
  - `addHighlightLayer` / `removeHighlightLayer` / `updateHighlightLayer` / `clearAllHighlights` act on `activeFigure.overlayLayers` when `panelRouteTarget(state)` is non-null.
  - `copyEmbeddingHighlightsToFigure(): void`

- [ ] **Step 1: Write the failing tests** in `store.test.ts`: create a figure (set `activeSlot`, `centerPanelView: 'figure'`); `addHighlightLayer(l)` lands in `activeFigure.overlayLayers` and the dataset's `highlightLayers` keeps its earlier layer; with `centerPanelView: 'scatter'` it lands on the dataset; `colorFigurePanel(p1, specForGenes(['Myl7']))` sets title `Myl7`; after `setFigurePanelTitle(p1, 'Mine')` a recolour keeps `Mine`; `setFigurePanelTitle(p1, '  ')` restores `Myl7` and `titleEdited === false`; `setFigureLayout(1,1)` with active `p4` leaves `activePanelId === null`; the new figure's `slot` is the active slot and `pointSize` equals `displayPreferences.pointSize`.
- [ ] **Step 2: Run** `npx vitest run src/store.test.ts`: FAIL.
- [ ] **Step 3: Implement**; fix the type errors `npx tsc --noEmit` reports in `FigureBuilder` / `FigurePanel` minimally (Tasks 4-5 finish them).
- [ ] **Step 4: Run** store tests and `npx tsc --noEmit`: PASS / clean.
- [ ] **Step 5: Commit** `feat(panels): figure owns slot, overlay and active panel; routed highlight actions`.

### Task 3: Route the panes' colour actions

**Files:**
- Modify: `frontend/src/hooks/useData.ts` (`selectColorColumn` 619, `colorByGene` 633, `colorByGenes` 672, `clearExpressionColor` 767, `colorByScore` 780, `colorByBivariate` 808, `clearBivariateColor` 863, `addGeneSetHighlight` 878 colour pick)
- Modify: `frontend/src/components/GenePanel.tsx` (874, 1248, 1867, 1913, bivariate call ~2493), `frontend/src/components/CellPanel.tsx` (1056)

**Interfaces:**
- Consumes: Task 1 `panelRouteTarget`, `editableHighlightLayers`, `spec*`; Task 2 `colorFigurePanel`.
- Produces: `colorByBivariate(genes1, genes2, label1?: string, label2?: string)`.

- [ ] **Step 1:** At the top of each colour action: `const target = panelRouteTarget(useStore.getState()); if (target) { useStore.getState().colorFigurePanel(target, <spec>); return }` (clear actions apply `SPEC_NONE`). `colorByGenes` passes `geneSetName` and `genesDown`.
- [ ] **Step 2:** Replace highlight-layer reads in GenePanel / CellPanel and the colour pick in `addGeneSetHighlight` with `editableHighlightLayers` (selector form `useStore(editableHighlightLayers)` with shallow-stable result: select the two arrays and pick in a `useMemo`).
- [ ] **Step 3:** GenePanel's bivariate button passes the two picks' names as labels.
- [ ] **Step 4: Run** `npx tsc --noEmit` and `npx vitest run`: clean / PASS.
- [ ] **Step 5: Commit** `feat(panels): Genes and Cells panes colour the active panel while Panels shows`.

### Task 4: `FigurePanel` rendering

**Files:**
- Modify: `frontend/src/components/FigurePanel.tsx`

**Interfaces:**
- Consumes: Task 1 `panelRequest`, `categoryCentroids`; `lib/labelLayout.layoutLabels`; `lib/textAnnotations.viewTransform`; Task 2 fields and `setFigurePanelTitle`.

- [ ] **Step 1:** Fetch through `panelRequest(panel, displayPreferences, displayLayer)` + `appendDataset(url, figure.slot)`; parse `obs` (category / numeric), `obsm/column`, expression, bivariate responses into the existing `PanelColorData`. Refetch when the spec or Display's scoring fields change.
- [ ] **Step 2:** Overlay from `figure.overlayLayers` when `panel.showHighlightOverlay`; radius `figure.pointSize` (not halved).
- [ ] **Step 3:** Title: a click on the title (stopPropagation) swaps in an input; Enter / blur → `setFigurePanelTitle`; Escape cancels. Placeholder `Click to name` only on the active panel when the title is empty.
- [ ] **Step 4:** Labels: when `panel.showLabels` and the data is a category, centroids over the figure's cells, projected with `viewTransform(target, zoom, w, h)` (container size by ResizeObserver), placed by `layoutLabels({ fontPx: panel.labelFontSize, bounds })`, drawn in an SVG with `data-panel-labels` (white bold text, dark stroke halo, leader line when shifted), the Embedding tab's styling.
- [ ] **Step 5: Run** `npx tsc --noEmit`: clean. **Commit** `feat(panels): panels draw Display-scored colours, the figure overlay, inline titles and labels`.

### Task 5: `FigureBuilder`, Cells pane, export

**Files:**
- Modify: `frontend/src/components/FigureBuilder.tsx`, `frontend/src/components/CellPanel.tsx` (Create figure button ~2145-2166, handler 1483), `frontend/src/utils/exportFigure.ts`, `frontend/src/components/ScatterPlot.tsx` (centroid block 1040-1066 → `categoryCentroids`)

- [ ] **Step 1:** Auto-create: when Panels shows with no figure and the store has an embedding with coordinates, `createFigure` over every cell with the embedding's dims. Empty state text only for "no embedding": `Load a dataset with an embedding to compose panels.`
- [ ] **Step 2:** Toolbar: `Crop to selection (N)` when cells are selected, `All cells` when the figure is cropped (fewer cells than the embedding).
- [ ] **Step 3:** Active panel from the store; a hint at the top of the sidebar: `Colour the active panel from the Genes or Cells pane.` Keep the colour pickers as fallback but route them through `colorFigurePanel`; drop the transform picker. Panel title input uses `setFigurePanelTitle`.
- [ ] **Step 4:** Labels block (category colouring only): `Labels on plot` checkbox + font size `NumberInput` (6-40).
- [ ] **Step 5:** Overlay section (figure level): layers with swatch, label, × remove; `Copy from Embedding` when the dataset has layers; hint `Add layers with 🖍 in the Genes pane while Panels is open.` Panel row keeps `Show overlay`.
- [ ] **Step 6:** Slot notice when `figure.slot !== activeSlot`: `This figure shows <dataset>. Switch back to colour it, or start a new figure here.` + `New figure` button.
- [ ] **Step 7:** Remove the Cells pane button and handler. Export draws each `[data-panel-labels] text` (and leader lines) at its measured position with the halo. ScatterPlot uses `categoryCentroids`.
- [ ] **Step 8: Run** `npx tsc --noEmit`, `npx vitest run`: clean / PASS. **Commit** `feat(panels): open straight into a figure; crop, overlay, labels and slot notice in the Panels pane`.

### Task 6: Verify, record, merge

- [ ] Browser check on an isolated stack (backend :8100 from the worktree, Vite :5273), Grosswendt demo: Panels opens with 4 panels; click panel 2, click a gene in the Genes pane → panel 2 titled and coloured, Embedding unchanged; celltype *Color* in Cells pane → panel 3, labels on, font 16; 🖍 a set → figure overlay, all panels show it, Embedding does not; edit a title in place; crop to a selection; Export PNG contains the labels.
- [ ] CHANGELOG `[Unreleased]` entries; CLAUDE.md note on routing; memory.
- [ ] Merge `feat/expression-group-columns` and `feat/panels-redesign` into main `--no-ff` (Patrick: "merge when done"), after checking :8000.
