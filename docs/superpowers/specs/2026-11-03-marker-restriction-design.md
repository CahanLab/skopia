# Restricting marker selections to an annotation

Date: 2026-11-03. Follows the marker-selection design
(`2026-11-03-marker-selection-dotplot-design.md`), which this extends.

## Intent

Patrick often wants a heatmap or dot plot of the top marker genes per group
*that are transcription factors*, or collagens, or carry some other
annotation, without re-running the marker test on only those genes. A marker
run already stores a ranked table per group (top `store_top_n`, default
500, by score), and Top N plus the filters are a read on it. The restriction
is one more filter on that read: keep only the stored candidates that are in
an allowed gene list, then apply the thresholds and take the top N.

Patrick's answer to the one design question: he expects only annotated genes
that are *among a group's strongest markers*, not every annotated gene the
test ranked. So the stored ranking's cap stays as it is. A restricted list
that comes up short means the annotation's genes were not strong markers for
that group, and the UI says so through the existing candidate counts and the
cap warning.

## Goals

- A selection on a stored run can be restricted to an allowed gene list
  with no re-run, from three places: the Find Marker Genes modal, the
  Expression tab's marker rows, and a saved heatmap / dot plot figure.
- The allowed list comes from what xcell already has: a Gene Panel gene set
  (up and down genes together) or a boolean `.var` column.
- Every surface says what the restriction is ("in TFs") and how many
  candidates each group had after it.

## Non-goals

- Storing more of the ranking, or re-ranking outside the store (decided
  above).
- A name pattern ("^Col") as a restriction source. A gene set made from
  the Gene Panel's search covers it.
- Editing the restriction of a saved figure in the Figures tab; it is an
  input, set when the figure is saved, like the figure's gene sets.

## Backend

**Pure module.** `marker_genes.select_markers(record, *, ..., genes=None)`:
`genes` is a collection of gene names or `None`. When given, a group's
stored rows are reduced to those whose gene is in the collection *before*
the thresholds, so `n_candidates` is the number of annotated genes that
passed and the result's `genes` are the top N of those. The response gains
`restricted: bool`.

**Restriction spec.** `{'label': str, 'genes': [...]} | {'label': str,
'var_column': str} | None`. A dict names exactly one source. The label is
what the UI showed (the set or column name) and is what titles and
summaries print.

**Adaptor.** `select_marker_genes(key, restrict_to=None, **selection)` and
`marker_gene_set_groups(key, restrict_to=None, **selection)` resolve the
spec to names: a `genes` list as is (names absent from the dataset simply
match nothing); a `var_column` through `_resolve_gene_mask(str)` (must be a
boolean `.var` column, else `ValueError`). The resolved names go to
`select_markers(genes=...)`. The select route and `_plot_rows` pass the spec
through unchanged. Selection is a read and is never logged.

**Routes.** `MarkerSelection` gains `restrict_to: MarkerRestriction | None`
where `MarkerRestriction(BaseModel)` has `label: str`, `genes: list[str] |
None = None`, `var_column: str | None = None`; a validator refuses both or
neither sources. `MarkerSourceSpec` inherits it, so `/api/heatmap/data` and
`/api/dotplot/data` take it inside `markers`.

**Figures.** Both expression kinds gain an input `marker_restrict`
(the spec or `None`), valid only with `marker_key`; `_validate_figure_inputs`
checks the shape and, for `var_column`, that the column exists and is
boolean. `_figure_row_groups` passes it to `marker_gene_set_groups`. A
`var_column` that no longer exists at draw time is `FigureInputMissing`
("Column 'x' no longer exists"), like a vanished marker run. The default
title reads "… markers markers_leiden in TFs …". `config.yaml` needs no new
key (inputs have no defaults). Provenance is unchanged: the restriction
draws from the same run step.

## Frontend

**Library.** `MarkerSource.restrictTo: {label, genes} | {label, varColumn}
| null`; `markerRequest` sends `restrict_to` in the wire shape;
`markerSummary` appends `in <label>`; `heatmapFigureFromConfig` /
`dotplotFigureFromConfig` put `marker_restrict` in inputs (wire shape) and
`defaultTitle` includes it. `normalizeHeatmapConfig` leaves an absent field
`null`.

**Restriction picker.** One small component, `RestrictionPicker`, used in
both places: a `<select>` whose options are *None*, then the Gene Panel's
sets with genes (`<name> (<n>)`, up and down genes together), then the
boolean `.var` columns (`<name> (<n_true>)`), grouped with `<optgroup>`.
Its value is the `MarkerSource.restrictTo` shape. The modal already fetches
the boolean columns; the picker takes them as a prop so the Expression
settings fetch them the same way (`GET /api/var/boolean_columns`).

**Find Marker Genes modal.** A "Show only:" row under the Advanced Filters
with the picker. Changing it re-selects through the debounced select call
like the other filters. The summary line reads "… in TFs"; the cap warning
(`capMatters`) also fires when a restriction is active, since a restriction
is a filter that could have wanted rows beyond the cap. *Plot…* carries the
restriction into `markerSource`.

**Expression settings.** The same row inside the marker rows section, below
Rank by. The toolbar summary shows it through `markerSummary`.

**Figures tab.** The restriction is visible in the Inputs line and the
title; it is not editable there (non-goal).

## Tests

Backend: pure `select_markers(genes=...)` (restricts before thresholds,
`n_candidates` counts after, unknown names match nothing, `restricted`
flag); adaptor resolution from a gene list and from a boolean column, and
a non-boolean column refused; the select route and `/api/dotplot/data`
with `markers.restrict_to`; a figure created with `marker_restrict` draws
the restricted rows, titles itself with the label, and reports a deleted
`var_column` as missing input; the h5ad round trip of such a figure.

Frontend: `markerRequest` / `markerSummary` / figure builders with a
restriction; a legacy `MarkerSource` without the field normalizes to
`null`; `RestrictionPicker` option grouping from sets and columns.

Browser: on the Grosswendt demo, make a gene set of a few known markers,
restrict the modal to it, see the select call and the shortened lists,
Plot…, confirm the Expression toolbar says "in <set>", save a dot plot
figure and confirm its title.
