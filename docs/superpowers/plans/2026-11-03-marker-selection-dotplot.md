# Marker selection and dot plots: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store marker-gene runs so top-X-with-filters is a read, plot them as heatmaps and scanpy-style dot plots, and keep both in the Heatmap tab and the Figures system.

**Architecture:** A marker run becomes a JSON record in `uns['skopia_marker_genes']`; a pure `marker_genes.py` selects from it. Heatmap and a new `dotplot.py` take resolved gene-set groups; the adaptor resolves a marker key into groups at request or draw time. Frontend: the Heatmap tab gains a plot-type and a row-source switch; the Figures tab gains a dot plot kind.

**Tech Stack:** FastAPI + scanpy backend, React/Zustand frontend, pytest, tsc.

**Spec:** `docs/superpowers/specs/2026-11-03-marker-selection-dotplot-design.md`

## Global Constraints

- Only `adaptor.py` touches AnnData; `marker_genes.py` and `dotplot.py` are pure.
- Route models must not narrow adaptor arguments (`gene_subset` stays `str | None` on the marker route as today; the new `markers` field is a model).
- Every new `_log_action` name needs a `codegen.REGISTRY` entry.
- Stats crossing the API: no NaN / inf; `None` for not computable.
- Tests: module-level `_adata()` / `_adaptor()` factories, seeded, `csr_matrix` float32, no conftest.
- Branch `feat/marker-selection-dotplot` off `main`, merge with `--no-ff`.

## Review Focus

1. A marker run whose group has fewer stored rows than `top_n` after filters: the response must carry `n_candidates` and the UI must not claim top N. Pinned in Task 1.
2. A run re-made under a freed key: figures hold the uid and must refuse the replacement. Pinned in Task 5.
3. A gene that the active gene mask hides, or a stored marker gene no longer in `var_names` after a gene filter: the dot plot must drop it and count it as hidden, not crash. Pinned in Task 4.
4. `log2fc` from scanpy can be `±inf` / NaN for all-zero genes: the stored table must be JSON-safe. Pinned in Task 1.
5. An older persisted `heatmapConfig` without the new fields must still draw a heatmap. Pinned in Task 6.

---

### Task 1: Pure selection module

**Files:**
- Create: `backend/skopia/marker_genes.py`
- Test: `backend/tests/test_marker_genes_store.py`

**Interfaces:**
- Produces: `build_table(names, scores, logfoldchanges, pvals, pvals_adj, pts, pts_rest, groups, store_top_n) -> dict[str, dict[str, list]]` where the scanpy inputs are the structured arrays / DataFrames from `uns['marker_genes']` (`names[group]` etc.) and `pts` / `pts_rest` are DataFrames indexed by gene with one column per group. Non-finite stats become `None`.
- Produces: `select_markers(record, *, top_n=10, min_pct_in=None, max_pct_out=None, min_log2fc=None, max_padj=None, rank_by='score', groups=None) -> dict` with `results: [{group, genes: [{gene, score, log2fc, pct_in, pct_out, pval, pval_adj}], n_candidates}]`, `n_stored_per_group: {group: int}`, `truncated: bool` (any group stored exactly `store_top_n` rows, so a filter could have lost candidates). `rank_by` other than `score` / `log2fc` is a `ValueError`; `top_n < 1` is a `ValueError`; unknown `groups` are a `ValueError`.
- Produces: `RANK_BY = ('score', 'log2fc')`.

- [ ] **Step 1: Write failing tests** `test_build_table_keeps_score_order_and_caps`, `test_build_table_replaces_non_finite_with_none`, `test_select_applies_inclusive_filters`, `test_select_reports_candidates_and_truncation`, `test_select_rank_by_log2fc`, `test_select_rejects_bad_rank_by_and_group`. Build a hand record: group `a` with genes `g0..g4`, scores 5..1, log2fc `[3, 1, 2, inf, nan]`, pct_in `[.9, .2, .5, .1, .0]`, pct_out `[.1, .1, .6, .0, .0]`, padj `[1e-5, .2, 1e-3, 1, 1]`. Assert `min_pct_in=0.5` → `g0, g2`; `max_pct_out=0.5` → `g0, g1, g3, g4`; `min_log2fc=2` → `g0, g2` (None never passes); `max_padj=0.01` → `g0, g2`; `rank_by='log2fc'` → `g0, g2, g1`.
- [ ] **Step 2: Run** `pixi run -e dev pytest tests/test_marker_genes_store.py -q` → fails on import.
- [ ] **Step 3: Implement the module.** Column-oriented lists; `select_markers` builds per-group masks with numpy over the lists, sorts by the chosen column descending (None last), truncates to `top_n`.
- [ ] **Step 4: Run tests** → pass. Commit `feat(markers): pure selection over a stored marker table`.

### Task 2: Stored runs in the adaptor and routes

**Files:**
- Modify: `backend/skopia/adaptor.py` (`run_marker_genes` ~14396; add store methods beside the enrichment store ~6490)
- Modify: `backend/skopia/api/routes.py` (~1781 marker routes)
- Modify: `backend/skopia/codegen.py:695` (summary) and add `marker_genes_delete`
- Modify: `backend/skopia/config.yaml` `marker_genes.store_top_n: 500`
- Test: `backend/tests/test_marker_genes_store.py` (extend)

**Interfaces:**
- Produces: `MARKER_UNS_KEY = 'skopia_marker_genes'`; `_marker_store() -> dict[str, str]`; `_store_marker_run(key_hint, record) -> str`; `list_marker_runs() -> list[dict]` (key, uid, label, obs_column, n_groups, n_cells_tested, cell_subset, created_at, store_top_n); `get_marker_run(key, include_table=False) -> dict` (KeyError); `delete_marker_run(key) -> {'deleted': key}` logs `marker_genes_delete`; `select_marker_genes(key, **selection) -> dict` (Task 1 result plus `key`, `uid`, `obs_column`); `marker_gene_set_groups(key, **selection) -> list[{name, genes}]` in the record's group order, only non-empty groups; `_marker_run_uid(key) -> str | None`.
- `run_marker_genes(..., store_top_n: int | None = None, label: str | None = None)` returns today's keys plus `key`, `uid`, `truncated`, each group `n_candidates`, each gene also `score`, `pct_in`, `pct_out`. Scanpy call adds `pts=True`; the `filter_rank_genes_groups` block is removed, thresholds map to `select_markers` (`min_log2fc = log2(min_fold_change)`).
- Routes: `GET /api/marker_genes/runs` → `{runs: [...]}`; `GET /api/marker_genes/runs/{key}?table=false`; `DELETE /api/marker_genes/runs/{key}`; `POST /api/marker_genes/runs/{key}/select` body `MarkerSelection(top_n=10, min_pct_in, max_pct_out, min_log2fc, max_padj, rank_by='score', groups)`. `MarkerGenesRequest` gains `store_top_n: int | None`, `label: str | None`. `MarkerGenesResponse` dropped as a response_model (the dict is returned directly) so the new fields pass.

- [ ] **Step 1: Failing tests** on the Task-1 fixture dataset from `test_marker_genes_cell_scope.py` (copy its `_adata`): `test_run_stores_a_record_with_pct_columns` (record in `uns`, JSON string, `pct_in` for `g00` in group `a` > 0.9, score order), `test_run_truncates_to_store_top_n` (`store_top_n=3` → 3 rows per group, `truncated` True), `test_keys_do_not_collide` (two runs → `markers_grp`, `markers_grp_2`), `test_old_filter_fields_select_post_hoc` (`min_fold_change=4` keeps `g00` for `a`, drops noise), `test_select_route_reads_without_rerun` (monkeypatch `sc.tl.rank_genes_groups` to raise after the first run; the select route still answers), `test_delete_logs_and_removes`, `test_record_survives_h5ad_round_trip` (write to tmp_path, read, `select_markers` works), `test_marker_run_list_route`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.** Follow `_store_enrichment` for keys/uid. `created_at` ISO UTC seconds. Log result adds `key`, `uid`, `truncated`.
- [ ] **Step 4: Run the new file plus `test_marker_genes_cell_scope.py` and `test_codegen.py`** → pass. Commit.

### Task 3: Heatmap from a marker run

**Files:**
- Modify: `backend/skopia/api/routes.py` (`HeatmapRequest` ~2267)
- Modify: `backend/skopia/adaptor.py` (helper `_resolve_marker_groups(markers: dict | None) -> list[{name, genes}]`)
- Test: `backend/tests/test_marker_genes_store.py` (extend)

**Interfaces:**
- Produces: `class MarkerSourceSpec(MarkerSelection): key: str`; `HeatmapRequest.markers: MarkerSourceSpec | None`; `genes: list[str] = []`.
- Produces: `DataAdaptor.heatmap_groups_from_markers(markers: dict | None) -> list[dict]` (validates key, returns groups).

- [ ] **Step 1: Failing test** `test_heatmap_route_accepts_a_marker_source`: POST `/api/heatmap/data` with `genes: []`, `markers: {key, top_n: 2}`, `cell_ordering: 'category'`, `obs_column: 'grp'` → `row_groups` contain `a`, `b`, `c`; row count ≤ 6. Also `test_heatmap_route_refuses_unknown_marker_key` → 404.
- [ ] **Step 2 to 4:** implement the route (genes = marker genes + request genes, deduped; groups prepended), run, commit.

### Task 4: Dot plot module, adaptor path, and route

**Files:**
- Create: `backend/skopia/dotplot.py`
- Modify: `backend/skopia/adaptor.py` (`dotplot_data`)
- Modify: `backend/skopia/api/routes.py` (`POST /api/dotplot/data` beside the heatmap route)
- Test: `backend/tests/test_dotplot.py`

**Interfaces:**
- Produces: `compute_dotplot(expr: np.ndarray, categories: np.ndarray, genes: list[str], gene_set_groups: list[dict] | None = None, *, expression_cutoff: float = 0.0, color_by: str = 'mean', standard_scale: str = 'none', gene_ordering: str = 'as_provided', category_order: list[str] | None = None) -> dict` with `genes`, `row_groups` (set name or None per gene, like the heatmap's), `categories`, `n_cells`, `n_cells_per_category`, `pct: list[list[float]]` (genes × categories, fraction > cutoff), `mean: list[list[float]]`, `color_label: str` (`'Mean expression'` / `'Mean expression in expressing cells'` / `'Scaled mean expression'`). Constants `COLOR_BY = ('mean', 'mean_expressing')`, `STANDARD_SCALE = ('none', 'gene')`, `GENE_ORDERINGS = ('as_provided', 'peak_group')`. A gene listed twice in different groups appears twice (scanpy behaviour).
- Produces: `DataAdaptor.dotplot_data(genes, gene_set_groups, obs_column, *, transform=None, cell_indices=None, **params) -> dict` adding `n_genes_hidden`, `obs_column`, `category_colors` (from `uns['<col>_colors']` or None). Categories limited to those present among the cells drawn, in category order. Raises `ValueError` when `obs_column` is missing or not categorical.
- Produces: `DotplotRequest`: `genes: list[str] = []`, `gene_set_groups`, `markers: MarkerSourceSpec | None`, `obs_column: str`, `transform`, `cell_indices`, `expression_cutoff=0.0`, `color_by='mean'`, `standard_scale='none'`, `gene_ordering='as_provided'`.

- [ ] **Step 1: Failing tests.** Matrix 6 cells × 3 genes, categories `a,a,a,b,b,b`, values chosen so `pct[g0] = [1.0, 1/3]`, `mean[g0] = [2.0, 1/3]`, `mean_expressing[g0][b] = 1.0`; cutoff 1.5 changes pct; `standard_scale='gene'` → row max 1.0 and min 0.0; `peak_group` puts a gene peaking in `b` after genes peaking in `a`; `gene_set_groups` labels rows; adaptor: `log1p` transform changes the mean, a gene hidden by the mask is counted in `n_genes_hidden`; an unknown gene is skipped; route 200 and 400 on a non-categorical column; route with `markers` works.
- [ ] **Steps 2 to 4:** implement, run, commit.

### Task 5: Figures backend

**Files:**
- Modify: `backend/skopia/adaptor.py` (`FIGURE_KINDS`, `_FIGURE_PARAM_KEYS`, `_validate_figure_inputs`, `create_figure` input_ids, `_figure_provenance_steps`, `_default_figure_title`, `figure_data`, `update_figure` checks)
- Modify: `backend/skopia/config.yaml` figures section
- Test: `backend/tests/test_figures_adaptor.py`, `backend/tests/test_figures_routes.py` (schema pin if present)

**Interfaces:**
- `expression_heatmap` inputs gain `marker_key: str | None`; params gain `marker_top_n` (10), `marker_min_pct_in` (null), `marker_max_pct_out` (null), `marker_min_log2fc` (null), `marker_max_padj` (null), `marker_rank_by` ('score').
- New kind `expression_dotplot`: inputs `gene_sets` (may be empty with a marker key), `marker_key`, `obs_column` (required), `transform`, cell inputs; params the `marker_*` set plus `color_by` ('mean'), `standard_scale` ('none'), `expression_cutoff` (0), `gene_ordering` ('as_provided'), `swap_axes` (false), `colormap` ('viridis'), `vmax` (null), `dot_max` (null).
- `_marker_groups_for_figure(record, params) -> list[dict]`: raises `FigureInputMissing` when the key is gone or `input_ids[key] != uid`.
- `_figure_provenance_steps`: a step whose `result.key == marker_key` counts.

- [ ] **Step 1: Failing tests** (extend `_adata` with a marker run via `run_marker_genes('grp', store_top_n=10)`): `test_heatmap_figure_from_marker_key_resolves_groups`, `test_marker_params_override_changes_rows_without_rerun` (monkeypatch scanpy to raise), `test_deleted_marker_run_is_missing_input`, `test_rerun_under_the_same_key_is_missing_input` (delete, re-run → same key, new uid), `test_dotplot_figure_create_data_update`, `test_dotplot_requires_obs_column`, `test_figure_defaults_match_param_keys` (every `_FIGURE_PARAM_KEYS` key for both kinds exists in `config.yaml`), provenance includes the marker step.
- [ ] **Steps 2 to 4:** implement, run `test_figures_adaptor.py test_figures_routes.py test_codegen.py`, commit.

### Task 6: Frontend library layer

**Files:**
- Modify: `frontend/src/store.ts` (`HeatmapConfig`)
- Modify: `frontend/src/lib/figures.ts` (kind, label, `ExpressionDotplotData`, `dotplotFigureFromConfig`, marker params in `heatmapFigureFromConfig`)
- Modify: `frontend/src/lib/figureSchemas.ts` (`whenInput`, marker fields, dotplot fields)
- Create: `frontend/src/lib/markerSelection.ts` + `markerSelection.test.ts`
- Modify: `frontend/src/hooks/useData.ts` (`fetchMarkerRuns`, `selectMarkerGenes`, `fetchDotplotData`, response types)

**Interfaces:**
- `HeatmapConfig` adds `plotType?: 'heatmap' | 'dotplot'`, `markerSource?: MarkerSource | null`, `dotplot?: DotplotOptions`. `MarkerSource = { key: string; label: string; topN: number; minPctIn: number | null; maxPctOut: number | null; minLog2fc: number | null; maxPadj: number | null; rankBy: 'score' | 'log2fc' }`. `DotplotOptions = { colorBy, standardScale, expressionCutoff, geneOrdering, swapAxes, colormap, vmax, dotMax }`.
- `markerSelection.ts`: `markerRequest(src: MarkerSource) -> {key, top_n, min_pct_in, ...}` (nulls omitted), `markerParams(src) -> {marker_top_n, ...}` for figures, `markerSummary(src) -> string` (`top 10 of markers_leiden · pct in ≥ 0.25 · log2FC ≥ 1`), `normalizeHeatmapConfig(cfg) -> HeatmapConfig` filling defaults for old configs (Review Focus 5), `rowsFromConfig(cfg)` → `{genes, gene_set_groups, markers}` request fragment shared by both fetches.
- Tests pin each helper; `npx vitest run src/lib/markerSelection.test.ts` (check how existing `*.test.ts` run: `cd frontend && npx vitest run`).

- [ ] Steps: failing tests, implement, `npx tsc --noEmit`, commit.

### Task 7: Heatmap tab UI and dot plot renderer

**Files:**
- Modify: `frontend/src/components/HeatmapConfigModal.tsx`
- Modify: `frontend/src/components/HeatmapView.tsx`
- Create: `frontend/src/components/figures/ExpressionDotplotFigure.tsx`

**Interfaces:**
- `ExpressionDotplotFigure` is `forwardRef<SVGSVGElement, { data: ExpressionDotplotData; params: Record<string, unknown>; title?: string; width: number; background?: string; onGeneClick?: (gene: string) => void }>`, like `EnrichmentHeatmapFigure`. Layout: left labels, dots on a grid with cell size from width (min 14, max 28 px), size legend (3 reference dots) and color bar on the right, rotated column labels via `fitRotatedLabel`. `dotplotLegendFor(data)` not needed; the legend is inside the SVG.
- Config modal sections: Plot (radio), Rows (radio + marker picker + gene-set list), then the existing sections for heatmap or `Group by` + dot plot options for dotplot. `Generate` requires a marker source or ≥1 set, and for dotplot an obs column.
- `HeatmapView`: fetch by plot type; info line uses `markerSummary`; Save as figure uses `heatmapFigureFromConfig` / `dotplotFigureFromConfig`.

- [ ] Steps: implement, `tsc`, browser check in Task 10, commit.

### Task 8: Marker modal

**Files:**
- Modify: `frontend/src/components/MarkerGenesModal.tsx`, `frontend/src/lib/markerGenes.ts` (+ test)

**Interfaces:**
- `markerGenes.ts` adds `selectionFromModal(topN, minInGroupFraction, maxOutGroupFraction, minFoldChange) -> {top_n, min_pct_in?, max_pct_out?, min_log2fc?}` (fold change → log2) and `runSignature(inputs) -> string` (column, groups, gene subset, mask identity) so the modal knows when a re-run is needed.
- Modal: stores `resultKey`; filter edits after a run call `selectMarkerGenes` (300 ms debounce); the footer shows `Stored as <key>` and gains `Plot…` (sets `heatmapConfig` with `markerSource` from the current selection, `plotType: 'heatmap'`, `cellOrdering: 'category'`, `obsColumn`, and switches the center view to `heatmap`; closes the modal). Run button reads `Re-run test` when a stored run matches the signature.

- [ ] Steps: failing lib tests, implement, `tsc`, commit.

### Task 9: Figures tab

**Files:**
- Modify: `frontend/src/components/FiguresView.tsx` (dispatch `expression_dotplot` to the SVG path; hide `whenInput` fields when the input is null; dynamic `obs_column` not needed)
- Modify: `frontend/src/lib/figureSchemas.test.ts` if a pin exists (check `grep -rn FIGURE_SCHEMAS frontend/src --include=*.test.ts`).

- [ ] Steps: implement, `tsc`, run frontend tests, commit.

### Task 10: Browser verification, docs, changelog

- [ ] Start `pixi run -e pyscn backend` and `pixi run dev` (the user's backend is down, so nothing is disturbed). Load the toy dataset, run Find Marker Genes on a categorical column, change Top N after the run (network tab shows a `select` call, no `marker-genes` POST), click Plot…, confirm the heatmap, switch to Dot plot, Save as figure for both kinds, change `marker_top_n` in the Figures tab and see rows change, export PNG for the dot plot.
- [ ] Stop both servers.
- [ ] `CHANGELOG.md` under `## [Unreleased]`; CLAUDE.md gets a short "Marker runs" paragraph; memory note.
- [ ] Merge: `git checkout main && git merge --no-ff feat/marker-selection-dotplot`. Do not push.
