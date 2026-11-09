# Stored marker runs, post hoc marker selection, and dot plots

Date: 2026-11-03. Decided without review (the user asked for the work to
proceed without feedback); every choice below is the builder's call unless
marked as the user's.

## Intent

The user's ask (verbatim intent): heatmaps and dot plots whose rows are the
top-X marker genes per cell group, with post-analysis filters (percent
detected, log fold change, …) that do not re-run the marker test; scanpy-style
dot plots beside the existing heatmaps, without crowding the center panel.

Today `run_marker_genes` computes a Wilcoxon one-vs-rest ranking on a copy of
the data, returns the top N after optional scanpy filters, and discards the
rest. Changing N or a filter means re-running the test. The only way to plot
markers is *Add to Gene Sets* and then picking those sets in the heatmap
config, which freezes the selection.

## Goals

1. A marker run is a stored result: the full ranked table per group (capped),
   with the statistics the filters need, keyed in `uns` like enrichment runs.
2. Selecting "top X after filters" is a cheap read on that table, from the
   marker modal, the Heatmap tab, and saved figures alike.
3. A figure or heatmap can name a marker run as its row source; top X and the
   filters are figure *params*, so they are tuned live in the Figures tab and
   recorded with the figure.
4. A scanpy-style dot plot (dot size = fraction of cells in the group with
   expression above a cutoff, color = mean expression) as a second plot type
   in the same tab and as a figure kind.

## Non-goals

- Replacing the gene-set path. Literal gene sets remain a row source, and a
  heatmap can mix marker groups with gene sets.
- A new center-panel tab. The dot plot lives inside the Heatmap tab.
- New test statistics. Scanpy's Wilcoxon ranking stays; only the stored
  output changes.
- Marker runs across datasets or subsets other than what the run was scoped
  to; a run records its cell scope and the selection inherits it.

## Anti-goals

- A selection that silently reports fewer than X genes because the stored
  table was truncated. The response must say how many candidates each group
  had.
- A figure that re-runs the test at draw time.
- A heatmap figure whose stored gene list drifts from the run: a marker-sourced
  figure resolves against the stored run by key *and uid*, like enrichment
  figures.

## Design

### Backend: stored marker runs

- `uns['skopia_marker_genes'][key]` is a JSON string (h5ad cannot write nested
  object arrays; same reason as enrichment). Record fields:
  `key`, `uid`, `label`, `created_at`, `obs_column`, `groups` (list of the
  tested groups, in category order), `params` (gene_subset, groups requested,
  store_top_n, cell scope: `n_cells_tested`, `cell_subset` name if any,
  `n_cell_indices`), `n_genes_tested`, `singletons`, and `table`:
  `{group: {genes: [...], score: [...], log2fc: [...], pct_in: [...],
  pct_out: [...], pval: [...], pval_adj: [...]}}` column-oriented, in
  scanpy score order, truncated to `store_top_n` per group (default 500, from
  `config.yaml marker_genes.store_top_n`).
- `pct_in` / `pct_out` come from `sc.tl.rank_genes_groups(pts=True)`
  (`pts`, `pts_rest`), the fraction of cells with expression > 0.
- Key hint `markers_<obs_column>` through `_sanitize_subset_name`, de-collided
  with a numeric suffix as `_store_enrichment` does; `uid` as there.
- `run_marker_genes` keeps its signature and adds `store_top_n` and `label`.
  It stores the record, then returns the same shape as today plus `key`,
  `uid`, and per-group `n_candidates`, by calling the same selection function
  the select route uses with the run-time `top_n` and filter arguments. The
  scanpy `filter_rank_genes_groups` call goes: its three thresholds map onto
  the stored columns (`min_in_group_fraction` → `min_pct_in`,
  `max_out_group_fraction` → `max_pct_out`, `min_fold_change` → `min_log2fc`
  as `log2(min_fold_change)`), so the request fields keep their meaning.
  Existing tests pin the request fields, not the scanpy call.
- Pure module `marker_genes.py`:
  - `build_table(names, scores, logfoldchanges, pvals, pvals_adj, pts,
    pts_rest, groups, store_top_n)`.
  - `select_markers(record, *, top_n, min_pct_in=None, max_pct_out=None,
    min_log2fc=None, max_padj=None, rank_by='score', groups=None)` →
    `{'results': [{'group', 'genes': [{gene, score, log2fc, pct_in, pct_out,
    pval, pval_adj}], 'n_candidates'}], 'n_stored_per_group',
    'truncated': bool}`. `rank_by` is `score` (scanpy order) or `log2fc`.
    Filters are inclusive thresholds. A group with no stored rows yields
    an empty list.
- Adaptor: `_marker_store`, `list_marker_runs`, `get_marker_run`,
  `delete_marker_run` (logs `marker_genes_delete`), `select_marker_genes(key,
  **selection)`, and `marker_gene_set_groups(key, **selection)` →
  `[{name: group, genes: [...]}]` for the plotting paths.
- Routes: `POST /api/marker-genes` (unchanged path; response gains `key`,
  `uid`, `n_candidates`, `truncated`), `GET /api/marker_genes/runs`,
  `GET /api/marker_genes/runs/{key}` (record without the table unless
  `?table=true`), `DELETE /api/marker_genes/runs/{key}`,
  `POST /api/marker_genes/runs/{key}/select` (body `MarkerSelection`).
  Keys are sanitized to `[A-Za-z0-9_]`, so a path parameter is safe.
- `MarkerSelection` Pydantic model: `top_n: int = 10`, `min_pct_in`,
  `max_pct_out`, `min_log2fc`, `max_padj` (all `float | None`),
  `rank_by: str = 'score'`, `groups: list[str] | None`.

### Backend: plotting from a marker run

- `HeatmapRequest` gains `markers: {key, **MarkerSelection} | None`; `genes`
  may be empty when markers are given. The route resolves the marker groups
  through the adaptor and prepends them to `gene_set_groups` (one group per
  marker group, named by the group), then calls `compute_heatmap_data` as now.
- New pure module `dotplot.py`: `compute_dotplot(expr, categories, genes,
  gene_set_groups, *, expression_cutoff=0.0, color_by='mean',
  standard_scale='none', gene_ordering='as_provided')` where `expr` is cells
  × genes dense float64 and `categories` is a per-cell label array. Returns
  `{genes, row_groups, categories, n_cells, n_cells_per_category,
  pct (genes × categories), mean (genes × categories), color_label}`.
  `color_by='mean'` is scanpy's default (mean over all cells in the group);
  `'mean_expressing'` averages only the cells above the cutoff.
  `standard_scale='gene'` rescales each gene's means to 0..1 across groups.
  `gene_ordering='peak_group'` orders genes by the group where their mean
  peaks, within gene-set groups like the heatmap's orderings.
- Adaptor `dotplot_data(genes, gene_set_groups, obs_column, transform,
  cell_indices, **params)` pulls the expression (`normalized_adata` for
  `log1p`, as the heatmap does), applies the gene mask via
  `_filter_to_visible`, and calls the module. `POST /api/dotplot/data` mirrors
  `/api/heatmap/data` with the dot plot params and the same `markers` field.
- Figures:
  - `expression_heatmap` inputs gain `marker_key: str | null` (validated
    against the store; `gene_sets` may then be empty, but one of the two must
    be non-empty). `input_ids[marker_key] = uid`. Params gain `marker_top_n`
    (default 10), `marker_min_pct_in`, `marker_max_pct_out`,
    `marker_min_log2fc`, `marker_max_padj` (nullable), `marker_rank_by`.
    `figure_data` resolves the marker groups at draw time; a deleted or
    replaced run (uid mismatch) is `FigureInputMissing`.
  - New kind `expression_dotplot`: inputs `gene_sets`, `marker_key`,
    `obs_column` (required), `transform`, cell inputs. Params: the `marker_*`
    set, `color_by`, `standard_scale`, `expression_cutoff`, `gene_ordering`
    (`as_provided | peak_group`), `swap_axes` (default false: groups as rows,
    genes as columns, scanpy's layout), `colormap` (`viridis | reds | rdbu`),
    `vmax` (nullable), `dot_max` (nullable fraction that fills the largest
    dot; blank = 1.0).
  - `_figure_provenance_steps` also matches a marker run's creating step by
    `result.key == marker_key`.
  - `config.yaml figures.expression_dotplot` and the new `expression_heatmap`
    defaults; `FIGURE_SCHEMAS` gets the fields, with a `whenInput:
    'marker_key'` flag so the marker fields hide on figures without a run.
- Codegen: `marker_genes` summary corrected (it reports enrichment fields
  today) and `marker_genes_delete` added; both figure kinds replay through
  the existing `figure_create` entry.

### Frontend

- `HeatmapConfig` gains `plotType: 'heatmap' | 'dotplot'` (default
  `heatmap`), `markerSource: {key, label, topN, minPctIn, maxPctOut,
  minLog2fc, maxPadj, rankBy} | null`, and `dotplot: {colorBy,
  standardScale, expressionCutoff, geneOrdering, swapAxes, colormap, vmax,
  dotMax}`. `selectedGeneSets` may be empty when `markerSource` is set.
  Older persisted configs without the new fields read as heatmap + gene sets.
- `HeatmapConfigModal` (the in-panel config) gains two sections at the top:
  **Plot** (Heatmap | Dot plot radio) and **Rows** (Gene sets | Top marker
  genes). The marker option shows a run picker (from
  `GET /api/marker_genes/runs`, labelled by column, group count, cell scope
  and date), *Top N*, and the four filters plus rank-by. With no runs it
  shows one line pointing at *Find Marker Genes*. The gene-set checklist stays
  available under both so a user can add sets to marker groups. For a dot
  plot the cell-ordering and bins sections are replaced by a *Group by*
  column select (prefilled from the marker run's column) and the dot plot
  options; the gene-ordering section offers `as provided | by peak group`.
- `HeatmapView` fetches `/api/heatmap/data` or `/api/dotplot/data` by
  `plotType`, passes `markers` when set, and renders
  `ExpressionHeatmapFigure` or the new `ExpressionDotplotFigure` (SVG: genes
  × groups is small, and the SVG export path exists). The toolbar's info
  line names the marker run and selection (`top 10 of markers_leiden ·
  pct_in ≥ 0.25`). *Save as figure* maps to the matching kind.
- `MarkerGenesModal`: a run stores and shows *Stored as `key`*. After a run,
  changing Top N or a filter calls the select route (debounced) instead of
  invalidating the results; the Run button re-runs the test only when the
  column, groups, gene subset or mask changed (it reads *Re-run test* until
  then). *Add to Gene Sets* uses the current selection. A *Plot…* button
  sets `heatmapConfig` to the marker source with the modal's selection
  (plot type heatmap, cell ordering by the run's column) and switches to the
  Heatmap tab.
- `FiguresView`: `expression_dotplot` renderer and export via the SVG path;
  `whenInput` hides marker fields when `record.inputs.marker_key` is null.
  `lib/figures.ts` gains the kind, label, data type and
  `dotplotFigureFromConfig`.

### Scope note on the dot plot's expression source

The heatmap reads `adata.X` unless the display transform is `log1p`, in which
case it reads the lazily normalized copy. The dot plot does the same, and the
`transform` input records which. A dot plot on raw counts is what scanpy
draws when `.X` holds raw counts, so no new choice is introduced.

## Tests (backend, pytest, each file self-contained)

- `test_marker_genes_store.py`: a run writes the record with pct columns in
  score order, truncation at `store_top_n`, key de-collision, selection
  filters and rank-by, `n_candidates` and `truncated`, delete logs, the route
  response carries `key`, old filter fields map onto the new thresholds (the
  marked gene survives `min_fold_change`), JSON round-trips through h5ad
  write/read.
- `test_dotplot.py`: `compute_dotplot` on a known matrix (pct and mean by
  hand), cutoff, `mean_expressing`, standard scale, peak-group ordering, the
  adaptor path with `log1p` vs raw, gene mask hiding, the route.
- `test_figures_adaptor.py` additions: heatmap figure from a marker key
  resolves the groups, params override changes the rows without a re-run,
  deleted run → `FigureInputMissing`, re-run under the same key with a new
  uid → `FigureInputMissing`, dotplot figure create/data/update, defaults
  agree with the schema pin.
- `test_codegen.py` registry pins pass with the new action.

Frontend: `markerGenes.test.ts` gains the select-request builder;
`heatmapGroups.test.ts` or a new `lib/markerSelection.test.ts` pins the
info line and the config migration; `tsc --noEmit` clean.

## Left to the builder

- Exact SVG layout of the dot plot (legend placement, label rotation reuse
  from `stackedBars`).
- Debounce interval in the marker modal (300 ms is fine).
- Whether the run list in the config panel refetches on open only (yes; the
  modal re-mounts per open).
