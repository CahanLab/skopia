# Marker Restriction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict a marker selection (modal, Expression tab rows, saved figures) to a labeled gene list or a boolean `.var` column, as a read on the stored ranking.

**Architecture:** `select_markers` gains `genes=`; the adaptor resolves a restriction spec `{label, genes}|{label, var_column}` to names and threads it through `select_marker_genes` / `marker_gene_set_groups` / `heatmap_groups_from_markers` / `_figure_row_groups`; routes carry it inside `MarkerSelection.restrict_to`; figures record it as input `marker_restrict`. Frontend: `MarkerSource.restrictTo`, a `RestrictionPicker` used by both modals, pure helpers in `lib/markerSelection.ts`.

**Tech Stack:** FastAPI + pydantic, pytest; React + Zustand, vitest, tsc.

**Spec:** `docs/superpowers/specs/2026-11-03-marker-restriction-design.md`

## Global Constraints

- Selection is a read: never `_log_action`, never re-run the test.
- A restriction is not intersected with the session gene mask; the plot path drops hidden genes afterwards.
- "Boolean column" = what `get_var_boolean_columns` offers (bool dtype, or numeric holding only 0/1).
- Empty `genes` is refused ("the restriction names no genes"); both or neither source refused.
- Request models must not narrow the adaptor; `ValueError → 400`, `KeyError → 404`.
- Frontend: inline styles; `npx tsc --noEmit` and `npx vitest run` green.

## Review Focus

1. A restriction whose names are all absent from the dataset → every group empty, `restricted: true`, no error (Task 1 test `test_select_restriction_with_unknown_names_is_empty`).
2. A figure's `var_column` deleted after saving → `FigureInputMissing`, not a 400 (Task 3).
3. A `var_column` that is numeric 0/1, not bool dtype → accepted (Task 2 test).
4. A saved `MarkerSource` without `restrictTo` (pre-feature config) → normalizes to `null`; `markerRequest` omits the field (Task 4).
5. A snapshot whose set was deleted → picker shows `<label> (saved)` and keeps the snapshot (Task 4 `matchRestriction` test).

---

### Task 1: `select_markers(genes=...)`

**Files:**
- Modify: `backend/skopia/marker_genes.py:79-125`
- Test: `backend/tests/test_marker_genes_store.py` (pure section, after `test_select_on_a_group_with_no_rows_is_empty`)

**Interfaces:**
- Produces: `select_markers(record, *, ..., groups=None, genes: Collection[str] | None = None) -> dict` with `restricted: bool` in the result; rows are reduced to `gene in genes` before thresholds; `n_candidates` counts after.

- [ ] **Step 1: Write the failing tests**

```python
def test_select_restricts_to_an_allowed_gene_list_before_thresholds():
    sel = mg.select_markers(_record(), top_n=1, genes={'g1', 'g2', 'g6', 'nope'})
    assert _genes(sel, 'a') == ['g1'] and _genes(sel, 'b') == ['g6']
    assert sel['results'][0]['n_candidates'] == 2 and sel['restricted'] is True
    # thresholds apply inside the allowed list
    sel = mg.select_markers(_record(), top_n=5, genes={'g1', 'g2'}, min_pct_in=0.5)
    assert _genes(sel, 'a') == ['g2'] and sel['results'][0]['n_candidates'] == 1


def test_select_restriction_with_unknown_names_is_empty():
    sel = mg.select_markers(_record(), genes=['zzz'])
    assert all(r['genes'] == [] and r['n_candidates'] == 0 for r in sel['results'])
    assert sel['restricted'] is True
    assert mg.select_markers(_record())['restricted'] is False
```

- [ ] **Step 2: Run** `pixi run -e dev pytest tests/test_marker_genes_store.py -q -k restrict` — Expected: FAIL, `TypeError: unexpected keyword argument 'genes'`.
- [ ] **Step 3: Implement.** Add the `genes` kwarg; `allowed = set(genes) if genes is not None else None`; after building `rows`, `if allowed is not None: rows = [r for r in rows if r['genes'] in allowed]`; add `'restricted': allowed is not None` to the returned dict. Update the docstring's returns line.
- [ ] **Step 4: Run** the same command — Expected: PASS. Then `pixi run -e dev pytest tests/test_marker_genes_store.py -q` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(markers): select_markers takes an allowed gene list`.

### Task 2: Adaptor resolution and routes

**Files:**
- Modify: `backend/skopia/adaptor.py` (`get_var_boolean_columns` ~6336; `select_marker_genes` 6950; `marker_gene_set_groups` 6959; `heatmap_groups_from_markers` 7008)
- Modify: `backend/skopia/api/routes.py:1796-1810` (`MarkerSelection`)
- Test: `backend/tests/test_marker_genes_store.py` (adaptor + routes sections), `backend/tests/test_dotplot.py`

**Interfaces:**
- Consumes: Task 1 `select_markers(genes=...)`.
- Produces: `DataAdaptor._is_boolean_var_column(name: str) -> bool`; `DataAdaptor._restriction_genes(spec: dict | None) -> set[str] | None` (raises `ValueError` for a non-boolean column or a malformed spec: both/neither sources, empty genes); `select_marker_genes(key, restrict_to=None, **selection)`; `marker_gene_set_groups(key, restrict_to=None, **selection)`; `routes.MarkerRestriction(BaseModel)` with `label: str`, `genes: list[str] | None = None`, `var_column: str | None = None` and a `model_validator` enforcing exactly one non-empty source; `MarkerSelection.restrict_to: MarkerRestriction | None = None`.

- [ ] **Step 1: Write the failing tests**

```python
def test_adaptor_restricts_from_a_gene_list_and_a_boolean_column():
    a = _adaptor()
    key = a.run_marker_genes(obs_column='grp', top_n=3, store_top_n=10)['key']
    full = a.select_marker_genes(key, top_n=2)
    first = full['results'][0]['genes'][0]['gene']
    sel = a.select_marker_genes(key, top_n=2, restrict_to={'label': 'one', 'genes': [first, 'zzz']})
    assert [g['gene'] for g in sel['results'][0]['genes']] == [first] and sel['restricted'] is True
    a.adata.var['flag'] = [g == first for g in a.adata.var_names]          # bool dtype
    a.adata.var['flag01'] = a.adata.var['flag'].astype(int)                  # numeric 0/1 counts too
    for col in ('flag', 'flag01'):
        sel = a.select_marker_genes(key, top_n=2, restrict_to={'label': col, 'var_column': col})
        assert [g['gene'] for g in sel['results'][0]['genes']] == [first]
    a.adata.var['n_cells'] = np.arange(a.adata.n_vars)
    with pytest.raises(ValueError, match='boolean'):
        a.select_marker_genes(key, restrict_to={'label': 'x', 'var_column': 'n_cells'})
    with pytest.raises(ValueError, match='names no genes'):
        a.select_marker_genes(key, restrict_to={'label': 'x', 'genes': []})
    with pytest.raises(ValueError):
        a.select_marker_genes(key, restrict_to={'label': 'x', 'genes': ['g00'], 'var_column': 'flag'})
    groups = a.marker_gene_set_groups(key, top_n=2, restrict_to={'label': 'one', 'genes': [first]})
    assert groups == [{'name': full['results'][0]['group'], 'genes': [first]}]


def test_select_route_takes_restrict_to(monkeypatch):
    a = _adaptor()
    key = a.run_marker_genes(obs_column='grp', top_n=3, store_top_n=10)['key']
    c = _client(a, monkeypatch)
    first = c.post(f'/api/marker_genes/runs/{key}/select', json={'top_n': 1}).json()['results'][0]['genes'][0]['gene']
    r = c.post(f'/api/marker_genes/runs/{key}/select', json={'top_n': 5, 'restrict_to': {'label': 'one', 'genes': [first]}})
    assert r.status_code == 200 and [g['gene'] for g in r.json()['results'][0]['genes']] == [first]
    assert c.post(f'/api/marker_genes/runs/{key}/select', json={'restrict_to': {'label': 'x', 'genes': []}}).status_code == 422
    assert c.post(f'/api/marker_genes/runs/{key}/select', json={'restrict_to': {'label': 'x'}}).status_code == 422
```

In `test_dotplot.py`, extend `test_route_with_gene_sets_and_with_markers`: a second markers request with `'restrict_to': {'label': 'one', 'genes': [<first marker gene>]}` returns 200 and `genes == [first]`.

- [ ] **Step 2: Run** `pixi run -e dev pytest tests/test_marker_genes_store.py tests/test_dotplot.py -q -k restrict` — Expected: FAIL (`TypeError` on `restrict_to`; 422 not raised as the field is dropped).
- [ ] **Step 3: Implement.** Factor the predicate out of `get_var_boolean_columns` into `_is_boolean_var_column(name)` and call it there. `_restriction_genes(spec)`: `None → None`; validate exactly one of `genes` / `var_column`, non-empty genes; list → `set(map(str, genes))`; column → `KeyError` if absent, `ValueError(f"'{col}' is not a boolean .var column")` if the predicate fails, else `set(var_names[col.astype(bool)])`. `select_marker_genes` pops `restrict_to`, passes `genes=self._restriction_genes(...)`, and includes `restrict_to` in the returned dict (the label is what the UI echoes). `marker_gene_set_groups` forwards. `heatmap_groups_from_markers`: `spec.pop('restrict_to', None)` → pass as kwarg. Routes: add the model and the field; `select_marker_genes` route already does `**request.model_dump()`, so `restrict_to` arrives as a dict (or `None`).
- [ ] **Step 4: Run** the two test files — Expected: PASS.
- [ ] **Step 5: Commit** `feat(markers): restrict a selection to a gene list or a boolean .var column`.

### Task 3: Figures carry `marker_restrict`

**Files:**
- Modify: `backend/skopia/adaptor.py` (`_validate_figure_inputs` 7280-7316; `_figure_row_groups` 7466; `_default_figure_title` 7484)
- Test: `backend/tests/test_figures_adaptor.py`

**Interfaces:**
- Consumes: Task 2 `_restriction_genes`, `marker_gene_set_groups(restrict_to=...)`.
- Produces: input `marker_restrict: dict | None` on both expression kinds (only with `marker_key`), validated by the same rules; title "… markers <key> in <label> …".

- [ ] **Step 1: Write the failing test**

```python
def test_a_figure_restricted_to_an_annotation():
    a, key = _with_markers()
    first = a.select_marker_genes(key, top_n=1)['results'][0]['genes'][0]['gene']
    f = a.create_figure('expression_dotplot', inputs={'gene_sets': [], 'marker_key': key, 'obs_column': 'grp',
                                                      'marker_restrict': {'label': 'one', 'genes': [first, 'zzz']}})
    assert f['inputs']['marker_restrict'] == {'label': 'one', 'genes': [first, 'zzz']}
    assert 'in one' in f['title']
    d = a.figure_data(f['id'])
    assert d['genes'] == [first]
    a.adata.var['flag'] = [g == first for g in a.adata.var_names]
    g = a.create_figure('expression_heatmap', inputs={'gene_sets': [], 'marker_key': key, 'obs_column': 'grp',
                                                      'marker_restrict': {'label': 'flag', 'var_column': 'flag'}})
    assert a.figure_data(g['id'])['row_labels'] == [first]
    del a.adata.var['flag']
    with pytest.raises(FigureInputMissing, match='flag'):
        a.figure_data(g['id'])
    with pytest.raises(ValueError, match='marker_restrict'):
        a.create_figure('expression_heatmap', inputs={'gene_sets': [{'name': 's', 'genes': [first]}],
                                                      'marker_restrict': {'label': 'one', 'genes': [first]}})
    with pytest.raises(ValueError):
        a.create_figure('expression_heatmap', inputs={'gene_sets': [], 'marker_key': key,
                                                      'marker_restrict': {'label': 'x', 'genes': []}})
```

Also add `'marker_restrict': {'label': 'one', 'genes': [first]}` to the existing h5ad round-trip figure test if one covers marker figures, else assert in this test that `json.loads(a.adata.uns['skopia_figures'][f['id']])['inputs']['marker_restrict']['label'] == 'one'`.

- [ ] **Step 2: Run** `pixi run -e dev pytest tests/test_figures_adaptor.py -q -k restricted` — Expected: FAIL (`marker_restrict` missing from `inputs`).
- [ ] **Step 3: Implement.** In `_validate_figure_inputs`, read `restrict = inputs.get('marker_restrict') or None`; if set and no `marker_key`, `ValueError('inputs.marker_restrict needs inputs.marker_key')`; else call `self._restriction_genes(restrict)` for validation (a `KeyError` from a missing column becomes `ValueError`); include `'marker_restrict': restrict` in both returned dicts. In `_figure_row_groups`, wrap the column resolution: `try: groups += self.marker_gene_set_groups(key, restrict_to=inp.get('marker_restrict'), **sel) except KeyError as e: raise FigureInputMissing(f"Column '{col}' no longer exists; the figure cannot be drawn")`. Title: after `markers <key>`, append `f" in {restrict['label']}"`.
- [ ] **Step 4: Run** `pixi run -e dev pytest tests/test_figures_adaptor.py tests/test_figures_routes.py -q` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(figures): expression figures record a marker restriction`.

### Task 4: Frontend library

**Files:**
- Modify: `frontend/src/lib/markerSelection.ts`, `frontend/src/lib/figures.ts:147-200,281`, `frontend/src/lib/markerGenes.ts:88-99`
- Test: `frontend/src/lib/markerSelection.test.ts`, `frontend/src/lib/markerGenes.test.ts`

**Interfaces:**
- Produces: `type MarkerRestriction = { label: string; genes: string[] } | { label: string; varColumn: string }`; `MarkerSource.restrictTo: MarkerRestriction | null`; `restrictionWire(r) -> {label, genes} | {label, var_column}`; `markerRequest` adds `restrict_to` when set; `markerParams` unchanged; `markerSummary` appends `in <label>`; `restrictionOptions(sets: {id,name,genes,genesDown?}[], columns: {name,n_true}[]) -> {value: string, label: string, restriction: MarkerRestriction, group: 'Gene sets'|'.var columns'}[]` (value `set:<id>` / `col:<name>`; a set's genes are up+down deduped; sets with no genes omitted); `matchRestriction(options, snapshot) -> string` (the option value whose label equals the snapshot label and whose source kind matches, else `'saved'`); `defaultMarkerSource(...)` sets `restrictTo: null`; `heatmapFigureFromConfig` / `dotplotFigureFromConfig` put `marker_restrict: restrictionWire(src.restrictTo) | null` in inputs; `defaultTitle` appends ` in <label>`; `inputsSummary(inputs) -> string` in `figures.ts` (gene lists as `<name> (<n> genes)`, `marker_restrict` as `in <label>`, others `key: value`, null skipped); `selectionFromModal(topN, minIn, maxOut, minFc, restrictTo: MarkerRestriction | null = null)` adds `restrict_to`.

- [ ] **Step 1: Write the failing tests** (in `markerSelection.test.ts`)

```ts
const tf: MarkerRestriction = { label: 'TFs', genes: ['Sox2', 'Foxa2'] }
it('markerRequest carries the restriction in wire shape', () => {
  expect(markerRequest({ ...src, restrictTo: tf }).restrict_to).toEqual({ label: 'TFs', genes: ['Sox2', 'Foxa2'] })
  expect(markerRequest({ ...src, restrictTo: { label: 'flag', varColumn: 'flag' } }).restrict_to).toEqual({ label: 'flag', var_column: 'flag' })
  expect('restrict_to' in markerRequest(src)).toBe(false)
})
it('markerSummary names the restriction', () => {
  expect(markerSummary({ ...src, restrictTo: tf })).toBe('top 10 of markers_leiden · pct in ≥ 0.25 · log2FC ≥ 1 · in TFs')
})
it('a pre-feature source normalizes to no restriction', () => {
  const legacySrc = { ...src } as Partial<MarkerSource>; delete legacySrc.restrictTo
  expect(normalizeHeatmapConfig({ ...legacy, markerSource: legacySrc as MarkerSource }).markerSource?.restrictTo).toBeNull()
})
it('figure builders record marker_restrict and title it', () => {
  const fig = dotplotFigureFromConfig({ ...legacy, plotType: 'dotplot', markerSource: { ...src, restrictTo: tf }, dotplot: DEFAULT_DOTPLOT_OPTIONS }, null, null)
  expect(fig.inputs.marker_restrict).toEqual({ label: 'TFs', genes: ['Sox2', 'Foxa2'] })
  expect(fig.title).toContain('markers markers_leiden in TFs')
  expect(heatmapFigureFromConfig(legacy, null).inputs.marker_restrict).toBeNull()
})
it('restrictionOptions lists sets with genes then boolean columns, and matchRestriction finds a snapshot by label', () => {
  const opts = restrictionOptions([{ id: 'a', name: 'TFs', genes: ['Sox2'], genesDown: ['Sox2', 'Hes1'] }, { id: 'b', name: 'empty', genes: [] }], [{ name: 'flag', n_true: 3 }])
  expect(opts.map((o) => o.value)).toEqual(['set:a', 'col:flag'])
  expect(opts[0].restriction).toEqual({ label: 'TFs', genes: ['Sox2', 'Hes1'] })
  expect(opts[0].label).toBe('TFs (2)')
  expect(opts[1].restriction).toEqual({ label: 'flag', varColumn: 'flag' })
  expect(matchRestriction(opts, tf)).toBe('set:a')
  expect(matchRestriction(opts, { label: 'gone', genes: ['x'] })).toBe('saved')
  expect(matchRestriction(opts, null)).toBe('')
})
it('inputsSummary collapses gene lists', () => {
  expect(inputsSummary({ gene_sets: [{ name: 'immune', genes: ['a', 'b'] }], marker_key: 'markers_x', marker_restrict: { label: 'TFs', genes: ['a'] }, obs_column: 'leiden', transform: null }))
    .toBe('gene_sets: immune (2 genes) · marker_key: markers_x · in TFs · obs_column: leiden')
})
```

In `markerGenes.test.ts`: `selectionFromModal(5, '', '', '', tf)` has `restrict_to` equal to the wire shape; without the argument it has no `restrict_to` key.

- [ ] **Step 2: Run** `npx vitest run src/lib` — Expected: FAIL on the missing exports.
- [ ] **Step 3: Implement** per the Interfaces block. `normalizeHeatmapConfig` maps `markerSource` to `{ ...src, restrictTo: src.restrictTo ?? null }`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc --noEmit` — Expected: PASS (fix the `HeatmapConfigModal` / `MarkerGenesModal` object literals that now lack `restrictTo` by adding `restrictTo: null`; Task 5 fills them).
- [ ] **Step 5: Commit** `feat(frontend): marker restriction in the selection library`.

### Task 5: Picker and the two modals, Inputs line

**Files:**
- Create: `frontend/src/components/RestrictionPicker.tsx`
- Modify: `frontend/src/components/MarkerGenesModal.tsx` (state near 257; signature 325; select effect 332-339; run 430; `handlePlot` 460-476; `filtersActive` 504; Advanced Filters block ~490), `frontend/src/components/HeatmapConfigModal.tsx` (state 124-128; `handleApply` 213; marker section after Rank by ~319), `frontend/src/components/FiguresView.tsx:405`

**Interfaces:**
- Consumes: Task 4 helpers.
- Produces: `RestrictionPicker({ value: MarkerRestriction | null, onChange, sets, columns, style? })`: a `<select>` with option `''` = *None*, two `<optgroup>`s from `restrictionOptions`, and a disabled-looking but selectable `saved` option labelled `<label> (saved)` when `matchRestriction` returns `'saved'`; `onChange(null | option.restriction)`; selecting `saved` keeps the value.

- [ ] **Step 1: `RestrictionPicker`.** Sets come from `useStore` gene-set categories through the same flattening `HeatmapConfigModal.getAllGeneSets` uses (move that function to `lib/geneSets.ts` if it is not already exported; the modal keeps working). Columns are a prop.
- [ ] **Step 2: Marker modal.** `const [restrictTo, setRestrictTo] = useState<MarkerRestriction | null>(null)`; pass it as the fifth argument of every `selectionFromModal` call so the debounced effect re-selects and `lastSelection` tracks it; `filtersActive` becomes `... || restrictTo !== null`; add a "Show only:" row under the Advanced Filters inputs with `<RestrictionPicker columns={booleanColumns} ...>` and the title "Keeps only marker genes in this set or column; the test is not re-run, and a gene outside the stored ranking cannot appear"; `handlePlot` sets `restrictTo` in the `markerSource`.
- [ ] **Step 3: Expression settings.** `const [restrictTo, setRestrictTo] = useState(config?.markerSource?.restrictTo ?? null)`; fetch `appendDataset('/api/var/boolean_columns', activeSlot)` on open into `booleanColumns` (same shape as the marker modal); a "Show only" row below Rank by with the picker; `handleApply` includes `restrictTo`.
- [ ] **Step 4: FiguresView.** Replace `JSON.stringify(record.inputs)` with `inputsSummary(record.inputs)`.
- [ ] **Step 5: Run** `npx tsc --noEmit && npx vitest run` — Expected: clean, all pass.
- [ ] **Step 6: Commit** `feat(frontend): restrict marker rows to a gene set or .var column`.

### Task 6: Browser verification, docs, merge

- [ ] **Step 1:** Backend (`pixi run -e pyscn backend`) + Vite; load the Grosswendt demo via `POST /api/load`, normalize_total + log1p via the API; `PUT /api/gene_sets` a set named `few` with three genes from the marker run (or create it in the Gene Panel). Run Compare Cells → celltype (all 7 groups); in the modal set Show only = `few`: the network shows a `select` call carrying `restrict_to`, lists shorten, each group shows "k genes of n passing"; Plot… → toolbar says "in few"; Settings → the picker shows `few (3)` selected; Dot plot → Save as figure → Figures tab title ends "in few by celltype", Inputs line reads `in few`. Delete the set in the Gene Panel, reopen Settings: the picker shows `few (saved)`.
- [ ] **Step 2:** Stop both servers.
- [ ] **Step 3:** CHANGELOG under Unreleased (one bullet); CLAUDE.md marker-runs paragraph gains one sentence on `restrict_to`; memory note update.
- [ ] **Step 4:** `pixi run -e dev pytest -q` and `npx vitest run` green; commit docs.
- [ ] **Step 5:** Final review, fix pass, merge `--no-ff` into main. Do not push.
