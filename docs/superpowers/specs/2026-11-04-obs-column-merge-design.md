# Merging .obs columns: in Combine and in the .obs manager

**Status:** design, 2026-11-04. Requested by Patrick: "add functionality
that allows user to combine columns ... in many cases the columns to be
merged contain labels that are the same across datasets ... in many cases
the columns to be merged will have the same name ... make the most common
use case easiest to specify."

## Intent

Two datasets annotated with the same cell-type vocabulary should come out
of a combine with one `cell_type` column, not `cell_type__A` and
`cell_type__B`. Today the picker (`CombineColumnsPanel`) defaults every
label column to *one per dataset*, because pooling two independent
clusterings invents a comparison. That default is right for `leiden` and
wrong for shared annotations, and the user has to notice and flip each one.
A column that carries the same labels under a different name (`celltype`
in one file, `cell_type` in the other) cannot be pooled at all. And once a
dataset is loaded, there is no way to fold two columns into one.

## Goals

1. Same name, same labels: merged by default. The user confirms rather
   than configures.
2. Different names, same labels: one choice per column ("same as
   `cell_type`"), with the likely match named in the hint.
3. Loaded dataset: tick columns in the .obs manager, give the result a
   name, merge. Covers the post-hoc case (`cell_type__A` + `cell_type__B`
   from an earlier combine) and filling one annotation's gaps from another.

## Non-goals

- Label harmonisation (mapping `T cell` to `T_cell`). Rename labels after.
- Merging `.var` columns across names.
- Guessing cross-name merges by default. The hint names the candidate; the
  user picks it.

## Anti-goals

- Pooling cluster ids because they happen to overlap: `0..9` in both files
  is the dangerous case the picker exists for, and must stay *separate*.

## Design

### 1. Combine: suggestion rule for same-named label columns

`describe_combine_columns` already classifies every `.obs` column. For a
`category` / `string` column held by two or more datasets it now also
compares the label vocabularies (stringified non-null values):

- every label looks like a number (`^-?\d+(\.\d+)?$`): suggest `separate`,
  reason "labels are numbers: cluster ids, not comparable".
- Jaccard overlap of the union across holders >= 0.5: suggest `merge`,
  reason "same N labels in every dataset" when identical, else "K of N
  labels shared across datasets".
- otherwise `separate` with the existing reason.

Threshold 0.5 is a judgment call: two annotations of the same scheme on
different tissues share most but not all names. Recorded here so it can be
moved. Integer columns keep the existing cardinality rule (cluster ids).

The response entry gains `labels: {shared, union}` for label columns held
by >= 2 datasets (null otherwise) so the UI can show the counts.

### 2. Combine: merging columns with different names

New request field on `/api/combine` (and `combine_datasets`):
`obs_merge_into: {source_column: target_column}`. A source is pooled into
the target's output column; both are forced to policy `merge`.

Refused with a `ValueError` (400) naming the offender:
- source or target not held by any input;
- source == target;
- the target is itself a source (no chains; say "same as the final name");
- any one dataset holds both source and target, or two sources of the same
  target (a cell would have two values).

`uns['xcell_combine']['obs_merge_into']` records the mapping. Categories of
the merged column are the union, in order of first appearance across
inputs, as the existing merge already does.

`describe_combine_columns` reports `same_as: [{name, shared, union}]` per
label column: other label columns whose holder sets are disjoint from this
one, with non-numeric vocabularies, ordered by overlap. Entries with
Jaccard >= 0.5 are "likely"; the reason text names the best one ("looks
like `cell_type` in B: 8 of 9 labels shared"). Default stays `separate`.

### 3. Combine: the picker

Each `.obs` column's select keeps *one column / one per dataset / drop* and
adds an optgroup **Same as** listing the `same_as` entries, likely matches
first with their counts. The frontend policy value is `same:<target>`;
`lib/combineColumns.ts` splits the map into `obs_policy` and
`obs_merge_into` for the request. A column that is somebody's target shows
*one column*, disabled, titled "`celltype` is merged into it".
`summarizePolicy` counts `same:` as merged.

### 4. .obs manager: Merge

Ticking two or more columns enables a **Merge** button next to Export and
Delete. It opens a row in the edit area:

- **Into**: name input, default the ticked names' common prefix with a
  trailing `__` or `_` stripped (`cell_type__A`, `cell_type__B` →
  `cell_type`), else `merged`. Must be a new name (existing
  `newNameProblem`).
- Order line: "First non-empty value wins, in this order: a, b, c", the
  ticked columns in `.obs` order.
- **Keep the source columns** checkbox, default on.
- **Merge** button; status reports the result, including how many cells
  had a value in more than one column.

Backend `DataAdaptor.merge_obs_columns(columns, new_name, keep_sources=True)`:

- >= 2 distinct existing columns; new name via `_check_new_obs_name`.
- Kinds must agree in class: all labels (`categorical` / `string`), all
  numeric (`integer` / `float`), or all `boolean`. Mixed classes are refused
  naming the kinds. A saved subset's membership column is refused as a
  source.
- Coalesce: per cell, the first column in the given order with a non-null
  value. Labels → categorical with union categories in order of first
  appearance; numeric → float64; boolean → bool, refused if any cell would
  be missing (bool cannot hold NaN).
- Result: `{new_name, columns, kind, n_conflicts, n_missing, dropped}`;
  `n_conflicts` is cells with >= 2 non-null source values. No palette is
  written for the new column.
- `keep_sources=False` drops the sources through `_drop_obs_column`.
- `_log_action('merge_obs_columns', ...)`; codegen `EXACT` entry emits the
  same coalesce in pandas.

Route `POST /api/obs/merge_columns` `{columns, new_name, keep_sources}`,
error mapping as the other `.obs` routes. After the call the modal runs
both refresh channels, as the other mutations do.

## Left to the builder

Exact copy of hints, widths, and the vitest cases for the policy split.

## Rulings after the builder check (2026-11-04)

1. **Boolean sources are refused** in `merge_obs_columns`: a plain bool
   column has no missing cells, so "first non-missing wins" is just "the
   first column", and the boolean dtype cannot hold the gaps a real merge
   leaves. Message: convert to string first. (A boolean split by a combine
   arrives as object True/False/NaN, which is the label class, and merges.)
2. **Empty means null, `''` or `unassigned`** for label columns, in the
   manager merge and in its codegen. `unassigned` is xcell's own sentinel
   outside a mask (CNV clones, subset Leiden), and a merge that stops at it
   never reaches the real label. Numeric columns: null only.
3. **Class must agree across holders** for a pooled combine column: labels
   (`category` / `string`) with labels, numbers with numbers. `obs_merge_into`
   refuses a mismatch; a same-named column whose kinds differ across
   datasets is suggested `separate` with reason "types differ across
   datasets". Category restore after the concat unions in any values the
   recorded categories miss, so a category + string pool loses nothing.
4. **Overlap with three or more holders** is the intersection over all
   holders divided by the union. One outlier dataset sinks the column to
   `separate`, which is the conservative side.
5. **The rule applies to API callers too** (`_resolve_policy` and
   `describe_combine_columns` share the helper), so the picker and the
   combine agree. The numeric-vocabulary pattern is
   `^[A-Za-z]{0,2}-?\d+(\.\d+)?$`, so `C0`, `cl1` count as cluster ids.
6. **No palette for a merged column**; the sources' palettes go with the
   sources if dropped. A combine drops every input's `uns`, so the common
   case has none to carry anyway.
7. **Kinds in the manager come from `_obs_kind`.** A numeric result is
   int64 when every source is integer and no cell is left empty, float64
   otherwise.
8. `sample` is refused as an `obs_merge_into` source or target (the combine
   writes it). The frontend `same:` prefix splits on the first colon only.
