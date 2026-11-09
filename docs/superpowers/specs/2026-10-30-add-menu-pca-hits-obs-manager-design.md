# Add menu + text annotations, PCA-loading gene-set hits, .obs manager

Date: 2026-10-30. Requested by Patrick; he waived design review ("proceed
without my feedback unless needed"), so every choice below not quoted from
him is the implementer's call and is marked *(call)*.

Constraint for all three: his live skopia (:8000 / :5173) holds a real dataset.
Work happens only in `/private/tmp/claude-501/skopia-wt-*` worktrees on their
own ports; nothing is merged into `main` until he says so.

---

## 1. Toolbar "Draw" becomes "Add"; text annotations

**His words:** rename Draw to Add because the toolbar is crowded. Under Add:
Shape (lasso, polygon), Line (pencil, smooth curve, segmented line), Text
(add text to the current embedding, with control over standard text-box
parameters such as color and size).

### Menu
- Button label `✎ Add`; the split-button dropdown keeps its shape but groups
  tools under three section headers: **Shape** (Lasso, Polygon), **Line**
  (Pencil, Smooth Curve, Segmented Line), **Text** (Text). *(call: section
  headers in one dropdown rather than nested flyouts; one click fewer and no
  hover-intent bugs.)*
- Shape and Line tools behave exactly as today (`interactionMode === 'draw'`,
  `drawTool`). Text is its own `interactionMode` value `'text'` *(as built;
  the first draft made it a `drawTool`, but ScatterPlot treats every
  drawTool other than pencil/lasso as a click-to-add-vertex line tool, so a
  separate mode keeps the line code untouched)*. The main Add button
  re-enters whichever of draw/text was picked last.

### Text annotations
- **Data model** *(call)*: `TextAnnotation = { id, embeddingName, x, y, text,
  fontSize (px, screen-constant), color, fontWeight ('normal'|'bold'),
  fontStyle ('normal'|'italic'), background: string|null, backgroundOpacity,
  anchor ('start'|'middle'|'end'), angle (deg), visible }`. Coordinates are in
  embedding data space, so text stays attached to its place when panning and
  zooming; size is in screen pixels like axis labels in every plotting tool.
- **Per dataset**: lives in `DatasetState` (`textAnnotations`) with a flat
  mirror, like `drawnLines` (see the per-dataset state invariant).
- **Persistence**: backend `uns['skopia_text_annotations_json']` (JSON string,
  h5ad-safe), `GET/POST /api/text_annotations`, restored when a dataset loads
  and carried by every export because it is in `uns`. Synced the way lines
  are (`syncLinesToBackend`).
- **Creating**: in Text mode, click the plot → a text editor popover opens at
  the click with the text field focused; Enter/“Add” commits, Escape cancels,
  empty text never creates an annotation.
- **Editing**: in Text mode, clicking an existing annotation selects it and
  opens the same popover (text, size, colour, bold, italic, background colour
  + opacity or none, alignment, rotation, delete). Dragging a selected
  annotation moves it. Delete/Backspace (outside an input) removes it.
- **Defaults**: the style of the last annotation committed becomes the
  default for the next one *(call)*.
- **Rendering** *(as built)*: an SVG overlay component
  (`TextAnnotationOverlay`) mounted inside ScatterPlot, like the stored-shape
  overlay, rather than a deck.gl TextLayer: SVG gives per-label hit testing
  for click and drag, the box, rotation and multi-line text for free. Only
  notes on the shown embedding and column pair (`dimX`/`dimY`, as lines
  record) are drawn. Labels move with Adjust transforms (anchor only).
- **Storage** *(as built)*: a note on an embedding missing from `.obsm` is
  kept rather than refused, or one removed embedding would fail every later
  save of the whole list.
- **Out of scope**: text in 3D view (Add is hidden in 3D already), arrows /
  callout lines, rich text.

---

## 2. Analyze → Cells → PCA loadings: gene-set hits

**His words:** let the user give a set of genes; loadings with hits in the
displayed top *x* are highlighted when any gene in the set matches; allow
reordering the PC list: default PC number (as now), or PCs with hits at top,
more matches ranked higher.

- **Input** *(call)*: a gene field above the table (comma, space, or newline
  separated) plus a "From gene set…" dropdown that fills it from the Gene
  Panel's sets (store `geneSets` and category sets). Matching is
  case-insensitive on symbols *(call: mouse/human casing differences should
  not hide a hit)*.
- **Highlight**: a matched gene in the positive or negative list is drawn in
  the accent colour, bold, with a tinted chip; a row with ≥1 hit gets a left
  accent bar and a hit count column (`hits` = positive + negative matches,
  shown as `3 (2+/1−)`).
- **Order**: a select "Order PCs: PC number | Most gene-set hits". The hits
  order sorts by total hits desc, ties by PC number; PCs with zero hits keep
  PC order below them. Checked-PC state is keyed by PC number, so reordering
  never changes which PCs are checked.
- **Summary line**: "`k` of `n` genes appear in the top `x` of at least one
  PC; `m` PCs have hits". Genes from the set that are not in any displayed
  list are listed in a muted line (not an error: they may simply load lower).
- Pure logic in `frontend/src/lib/pcaLoadingHits.ts` with vitest tests
  (parsing, case-insensitive match, counts, ordering, tie-break). No backend
  change: the hits are computed over what the table already shows.

---

## 3. .obs manager

**His words:** a modal to see the `.obs` columns, their types, basic
information about each, and useful operations — at least selecting several
columns and deleting them together; opened from a new button next to "Cells".

- **Entry**: a small `⚙ .obs` button in the Cells panel header, beside the
  "Cells" title *(call: the header is where "Cells" is; the toolbar is the
  crowded thing he wants to relieve)*.
- **Backend**: `GET /api/obs/columns` → per column `{name, dtype, kind
  ('categorical'|'boolean'|'integer'|'float'|'string'|'other'), n_unique,
  n_missing, preview}` where preview is the top 3 categories with counts, or
  min / median / max for numbers; plus `has_colors`, `subset` (name if it is
  a saved cell subset's membership column), `prefix_group` (tool prefix such
  as `UCell_`, `LR_`, `SCN_`, `contour_`, `subset_`, `cnv`, `leiden`).
  Cheap enough for 15k cells × 100 columns synchronously.
- **Operations** (each logged with `_log_action` and given a `codegen`
  REGISTRY entry):
  - **Delete selected** (multi-select checkboxes, shift-click range, select
    all visible) → `POST /api/obs/delete_columns {columns}`; reuses
    `delete_obs_column` semantics per column (colours dropped, subset
    registry entry removed) in one logged action. Confirm with the in-page
    `ConfirmDialog`, which lists subset columns that will lose their subset.
  - **Rename** a column → moves `<col>_colors` too; refuses names that exist
    and refuses renaming a saved subset's column (its key is derived from the
    subset name).
  - **Duplicate** a column under a new name.
  - **Convert type**: to categorical, to string, to numeric (refused with a
    400 naming an example value when a value will not parse), to boolean
    (only for two-valued columns).
  - **Export selected** columns to CSV (cell id + columns), client-side
    download from `/api/obs/column/{col}` data or a small backend CSV route.
- **Table**: sortable by name / type / unique / missing; filter box; type
  filter chips. Columns currently used for colour-by are marked; deleting one
  resets colour-by the way the Cells panel's delete does.
- After any mutation: `refreshSchema()` + `refreshObsSummaries()`.
- **Out of scope**: editing individual values, `.var` (a `.var` manager can
  reuse the same component later).
