# Exclude Genes by Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze → Preprocess → Exclude Genes removes, or marks in `.var`, genes by GENCODE class and named gene set, from shipped tables or the file's own annotation.

**Architecture:** A build script ships `gene_types_{species}.tsv.gz` (both GENCODE releases' symbols, newest type). A pure module `gene_types.py` annotates the dataset's genes from that table or from the file's own `gene_class` and set columns. The adaptor builds one exclusion mask from names, patterns and types and uses it for the preview, the removal and the mark, so the three cannot disagree.

**Tech Stack:** Python (stdlib build script, numpy, pandas, PyYAML, FastAPI/Pydantic), React + TypeScript (inline styles), vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-25-exclude-genes-by-type-design.md`

## Global Constraints

- Analysis modules are pure: `gene_types.py` takes arrays, frames and names, never imports the adaptor, never mutates live state.
- Heavy or optional imports stay function-local in the adaptor; `yaml` is already a dependency (`config.yaml`).
- Error mapping: `ValueError → 400`, `KeyError → 404`; request models must not narrow what the adaptor accepts.
- Every new `_log_action` needs a `codegen.REGISTRY` entry or `test_codegen` fails.
- Stats crossing the API are JSON-serializable: no NaN, no inf.
- Tests: no conftest, module-level `_adata()` / `_adaptor()` factories, seeded rng, `csr_matrix` + `float32`; assert on the returned dict and the AnnData.
- Frontend: inline styles, palette panel `#16213e`, field `#0f3460`, accent `#4ecdc4`, warning `#e9a23b`; number fields via `NumberInput`.
- Prose (changelog, UI copy, comments): no em dashes, American spelling.
- Run commands from `/private/tmp/claude-501/skopia-wt4`: backend tests with `cd backend && "/Users/pcahan/Dropbox (Personal)/Code/xcell/.pixi/envs/pyscn/bin/python" -m pytest -q -p no:cacheprovider tests/<file>` (the main checkout's environment; the worktree has none); frontend `cd frontend && npx vitest run <file>` and `npx tsc --noEmit` (the worktree needs `frontend/node_modules`: symlink the main checkout's or run `npm ci` there).

## Review Focus

1. A 10x file whose `var_names` are symbols and whose `.var['gene_ids']` holds versioned ids (`ENSMUSG00000051951.5`): types come from the id path, and the header counts them as id matches. (Test in Task 2.)
2. An invalid regex typed in the pattern field while types are ticked: the preview shows the regex error in the panel, nothing crashes, Run reports the same error. (Test in Task 3.)
3. A file whose `.var['gene_class']` is categorical with missing values (another tool, not cryten): missing reads as `unannotated`, never as the string `nan`. (Test in Task 2.)
4. *Mark* with a column name that already exists as one of the file's set columns (`mt` in a cryten file): refused with a message naming the column, nothing written. (Test in Task 3.)
5. A dataset of neither species, or a human/mouse barnyard whose names carry `GRCh38_` / `mm10___` prefixes: the summary reports no species and the modal offers the picker; nothing is ticked or removed by default. (Test in Task 3.)

---

### Task 1: Shipped gene-type tables

**Files:**
- Create: `backend/skopia/data/build_gene_types.py`
- Create (generated): `backend/skopia/data/gene_types_mouse.tsv.gz`, `backend/skopia/data/gene_types_human.tsv.gz`
- Test: `backend/tests/test_gene_types_table.py` (load the script with `importlib.util.spec_from_file_location`, as `test_tf_census_bundles.py` loads `build_tf_census.py`, with `backend/skopia/data` on `sys.path` for its `build_gene_symbol_maps` import)

**Interfaces:**
- Consumes: `SOURCES`, `_attr` from `build_gene_symbol_maps.py` (same import style as `build_gene_positions.py`).
- Produces: `harvest_types(lines: Iterable[str]) -> dict[str, tuple[str, str, str]]` (gene_id without version → (symbol, gene_type, chromosome)); `merge_releases(releases: list[dict]) -> list[tuple[str, str, str, str]]` (oldest first in, rows out); the TSV header `gene_id\tsymbol\tgene_type\tchromosome`.

- [ ] **Step 1: Write the failing tests** in `test_gene_types_table.py`:
  - `test_harvest_reads_gene_lines_only`: three GTF lines (a `gene` line with `gene_id "ENSMUSG00000000001.5"; gene_type "protein_coding"; gene_name "Gnai3";` on `chr3`, a `transcript` line, a `#` comment) → `{'ENSMUSG00000000001': ('Gnai3', 'protein_coding', 'chr3')}`; a scaffold `JH584295.1` gene line is kept.
  - `test_merge_keeps_old_symbols_with_the_newest_type`: M23 `{'ID1': ('Olfr484', 'protein_coding', 'chr7'), 'ID2': ('Gm1', 'lncRNA', 'chr1')}`, M39 `{'ID1': ('Or5b3', 'protein_coding', 'chr7'), 'ID2': ('Gm1', 'processed_pseudogene', 'chr1')}` → rows `[('ID1','Or5b3','protein_coding','chr7'), ('ID2','Gm1','processed_pseudogene','chr1'), ('ID1','Olfr484','protein_coding','chr7')]`: every id's newest symbol first, then retired symbols, all carrying the newest type and chromosome; an id only in the old release keeps its own row.
  - `test_shipped_tables` (skip with a reason if the file is absent, so Step 2 can pass before the build): header exact; distinct protein-coding ids within mouse 21,000 to 24,000 and human 19,000 to 21,500; `Olfr484` and `Or5b3` both present in mouse with the same gene id.
- [ ] **Step 2: Run** `pytest tests/test_gene_types_table.py` → FAIL (module missing).
- [ ] **Step 3: Implement** the two functions and `main()` (writes both species, prints per-species row count, distinct ids, protein-coding ids). Docstring names the four GTFs, the row rule and why scaffolds are kept, in the style of `build_gene_positions.py`.
- [ ] **Step 4: Run** the tests → harvest and merge PASS, shipped-table test SKIPPED.
- [ ] **Step 5: Start the build in the background** (about 50 minutes, network): `cd backend/skopia/data && "/Users/pcahan/Dropbox (Personal)/Code/xcell/.pixi/envs/pyscn/bin/python" build_gene_types.py > <session scratchpad>/build_gene_types.log 2>&1` (log outside the repo). Continue with Task 2; return here when it finishes.
- [ ] **Step 6: Run** the tests again → all PASS. If a count falls outside its range, read the printed counts before touching the range.
- [ ] **Step 7: Commit** `feat(gene types): shipped GENCODE gene-type tables with both releases' symbols` (script, two tables, test).

### Task 2: The annotation module

**Files:**
- Create: `backend/skopia/gene_types.py`
- Create: `backend/skopia/data/gene_type_sets/mouse.yaml`, `backend/skopia/data/gene_type_sets/human.yaml`: copies of SJD's `resources/genesets/{mouse,human}.yaml` (under `/Users/pcahan/CahanLab Dropbox/Patrick Cahan/PC/PC/projects/SJD/analysis/claude_pipeline/`), unchanged below a new header comment naming the source path and the date copied.
- Test: `backend/tests/test_gene_types.py`

**Interfaces:**
- Produces:
  - `SPECIES = ('human', 'mouse')`; `RELEASES = {'mouse': 'GENCODE M23 + M39', 'human': 'GENCODE v32 + v50'}`; `CLASS_ORDER = ('protein_coding', 'lncRNA', 'pseudogene', 'small_rna', 'ig_tr', 'other', 'unannotated')`.
  - `load_sets(species) -> tuple[dict[str, dict], dict[str, str]]`: (set name → definition with `description`, `pattern`, `genes`, `chrom`, `biotype`; biotype → class).
  - `load_table(species, path=None) -> GeneTable` (cached per species when `path` is None). `GeneTable` holds `by_id: dict[str, int]`, `by_symbol: dict[str, int]` (first row wins, file order), `by_upper: dict[str, int]`, and row arrays `symbol`, `gene_type`, `chromosome`.
  - `@dataclass GeneTypeAnnotation`: `gene_type: list[str | None]`, `gene_class: list[str]`, `sets: dict[str, np.ndarray]` (bool per gene), `set_source: dict[str, str]` (`'file'` or `'skopia'`), `source: dict` (`{'kind': 'gencode'|'file', 'label': str, 'species': str | None}`), `matched: dict[str, int]` (`ensembl_id`, `symbol`, `unmatched`).
  - `annotate_from_table(names, ids, species, table=None) -> GeneTypeAnnotation`.
  - `annotate_from_var(var: pd.DataFrame, names, species, table=None) -> GeneTypeAnnotation | None`: None unless `var` has a non-boolean `gene_class` column.
  - `removal_mask(ann, classes, sets) -> np.ndarray`; raises `ValueError` naming the valid choices for an unknown class or set.

- [ ] **Step 1: Write the failing tests**, against a fixture table written to `tmp_path` (rows: Gnai3 protein_coding chr3; Rpl13 protein_coding chr8; mt-Co1 protein_coding chrM; Gm42418 lncRNA chr17; 1700001C02Rik protein_coding chr1; Hba-a1 protein_coding chr11; Pbsn processed_pseudogene chrX; Or5b3 protein_coding chr7 plus its retired row Olfr484; a `TEC` gene; an `IG_V_gene`):
  - `test_classes_from_biotype`: TEC → `lncRNA`, IG_V_gene → `ig_tr`, a biotype absent from the map → `other`, a name absent from the table → `unannotated`.
  - `test_match_order`: `.var` ids `ENSMUSG...0001.5` win over the name; a var name that is an id matches; a retired symbol (`Olfr484`) matches with the newest type; counts land in `matched`.
  - `test_upper_case_fallback_is_human_only`: against a human fixture row `GNAI3`, the dataset name `Gnai3` matches by upper-casing; against the mouse fixture row `Gnai3`, the dataset name `GNAI3` stays `unannotated`.
  - `test_sets_by_pattern_genes_chrom_biotype`: `mt-Co1` in `mt` (chrom and pattern), `Rpl13` in `ribo`, `Rps6ka1` not in `ribo`, `Gm42418` in `predicted` and `rrna`, `Hba-a1` in `hb`, `Pbsn` in `x_linked`.
  - `test_pattern_sets_reach_unannotated_and_id_indexed_genes`: an unannotated `Gm99999` is `predicted`; on a dataset indexed by ids, `Rpl13`'s id is in `ribo` through the table symbol.
  - `test_file_annotation_wins`: a var with categorical `gene_class` (values `protein_coding`, `exogenous`, and one missing) and a boolean `ribo` column; classes are read as found with the missing one as `unannotated` (Review Focus 3); `ribo` has `set_source == 'file'`; `mt` is computed with `set_source == 'skopia'`; `source['kind'] == 'file'`.
  - `test_versioned_gene_ids_column` (Review Focus 1): symbols as names, `gene_ids` with `.5` suffixes → all matched as `ensembl_id`.
  - `test_removal_mask_rejects_unknown_names`.
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement.** Patterns use `re.search` (SJD used `str.contains`); a `pattern` or `genes` condition matches the dataset name **or** the matched table symbol; `chrom` and `biotype` conditions use the table row (or, for a file source, the file's `chrom` and `biotype` columns when present). For a file source, `gene_type` is the file's `biotype` column when present, else None.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(gene types): annotate genes by GENCODE class and named set, or by the file's own annotation`.

### Task 3: Adaptor: summary, removal, mark

**Files:**
- Modify: `backend/skopia/adaptor.py` (`run_exclude_genes` at ~8704; new methods beside it)
- Test: `backend/tests/test_exclude_gene_types.py`

**Interfaces:**
- Consumes: Task 2's `annotate_from_var`, `annotate_from_table`, `removal_mask`, `CLASS_ORDER`, `RELEASES`.
- Produces:
  - `types` shape everywhere: `{'classes': list[str], 'sets': list[str], 'species': str | None}`.
  - `_gene_type_annotation(species: str | None) -> GeneTypeAnnotation | None` (file first, else the table for `species or guess_species()`; None when no species).
  - `_exclusion_mask(gene_names, patterns, types) -> tuple[np.ndarray, np.ndarray]` (total mask, types-only mask). The one place the mask is built.
  - `gene_type_summary(species=None, gene_names=None, patterns=None, types=None) -> dict` with keys `species`, `available_species`, `source`, `n_genes`, `matched`, `classes` (list of `{name, n, examples}` in `CLASS_ORDER`, then file-only classes such as `exogenous`), `sets` (list of `{name, description, n, examples, computed_by}`), `selection` (`{n_removed, n_kept, examples, n_added_by_names_patterns, added_examples}` or None). Examples: at most 8 names.
  - `run_exclude_genes(gene_names=None, patterns=None, types=None)`: result adds `n_removed_by_types`, `type_source`; the action records `types` and `type_removed_genes` (every gene in the types-only mask).
  - `annotate_gene_types(types, column, gene_names=None, patterns=None, species=None, overwrite=False) -> dict` (`{column, n_kept, n_marked_out, wrote_type_columns: list[str]}`); logs `annotate_gene_types`.

- [ ] **Step 1: Write the failing tests** (an `_adata()` of about 12 mouse symbols drawn from the Task 2 fixture plus `tdTomato` and `Rps6ka1`; monkeypatch `gene_types.load_table` to the fixture):
  - `test_summary_total_equals_run`: with patterns `['^Rps']` and types `{'classes': ['lncRNA', 'pseudogene', 'small_rna', 'ig_tr', 'other'], 'sets': ['mt', 'ribo', 'predicted'], 'species': 'mouse'}` (what the frontend preset sends), `selection.n_removed` equals the run's `n_genes_removed`, and `n_added_by_names_patterns == 1` with `Rps6ka1` among `added_examples`.
  - `test_run_by_types_only` and `test_run_by_types_names_and_patterns`: assert `var_names` after the run and the recorded `type_removed_genes`.
  - `test_unannotated_is_never_removed_unless_ticked`: `tdTomato` survives the preset.
  - `test_invalid_regex_in_summary` (Review Focus 2): `patterns=['([']` raises `ValueError` mentioning the pattern.
  - `test_mark_matches_run_and_keeps_existing_columns`: the boolean column is False exactly where the run would remove; on a var that already has `gene_class`, `wrote_type_columns == []` and `gene_class` is unchanged.
  - `test_mark_refuses_existing_column` (Review Focus 4): column `ribo` on a file with a `ribo` set column → `ValueError` naming `ribo`; `overwrite=True` rewrites only that column; `highly_variable` is refused even with overwrite.
  - `test_no_species` (Review Focus 5): names `GRCh38_A`, `mm10___B` → `species is None`, `available_species == ['human', 'mouse']`, `classes == []`; `run_exclude_genes(types={...,'species': None})` raises `ValueError`.
  - `test_summary_is_json_serializable`: `json.dumps(summary)` succeeds.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement**; reset the same caches `run_exclude_genes` resets today; `annotate_gene_types` writes `gene_class` as categorical only when absent.
- [ ] **Step 4: Run** this file and `tests/test_codegen.py` → this file PASS; codegen FAILS on the unregistered `annotate_gene_types` (expected until Task 4).
- [ ] **Step 5: Commit** `feat(exclude genes): exclusion and mark by gene type, one mask for preview, run and mark`.

### Task 4: Routes and code export

**Files:**
- Modify: `backend/skopia/api/routes.py` (`ExcludeGenesRequest` at ~2490, route at ~2999)
- Modify: `backend/skopia/codegen.py` (`_code_exclude_genes` at ~252, `REGISTRY` at ~516)
- Test: `backend/tests/test_exclude_gene_types_routes.py`; add cases to `backend/tests/test_codegen.py`

**Interfaces:**
- Consumes: Task 3's adaptor methods.
- Produces: `GeneTypeSelection(BaseModel)`: `classes: list[str] = []`, `sets: list[str] = []`, `species: str | None = None`. `ExcludeGenesRequest.types: GeneTypeSelection | None = None`. `POST /api/scanpy/exclude_genes/types` (body `GeneTypeSummaryRequest`: `species`, `gene_names`, `patterns`, `types`, all optional). `POST /api/scanpy/annotate_gene_types` (body `AnnotateGeneTypesRequest`: `types`, `column = 'analysis_genes'`, `gene_names`, `patterns`, `species`, `overwrite = False`).

- [ ] **Step 1: Write the failing tests**: route tests via `monkeypatch.setattr(routes, "get_adaptor", lambda dataset=None: a)` posting the exact JSON the modal sends (types dict with both lists) to all three routes, asserting 200 and a 400 for an unknown set name; codegen: `exclude_genes` with `type_removed_genes: ['Gm1', "it's"]` compiles and, executed on an AnnData holding those genes, drops exactly them plus the pattern matches; `annotate_gene_types` compiles with and without params and summarizes.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `_code_exclude_genes` ORs `adata.var_names.isin(<type_removed_genes>)` into `_drop`; fidelity stays EXACT; summary text counts the types. `annotate_gene_types`: fidelity SKOPIA, imports `SKOPIA_API`, emits `xa.annotate_gene_types(...)` with the recorded arguments.
- [ ] **Step 4: Run** the new route file, `tests/test_codegen.py`, then the whole backend suite → PASS (the iMac's three known failures, listed in CLAUDE.md, do not occur on the MacBook).
- [ ] **Step 5: Commit** `feat(exclude genes): routes for the type summary and mark; code export lists the genes types removed`.

### Task 5: Frontend rules (pure)

**Files:**
- Create: `frontend/src/lib/geneTypes.ts`, `frontend/src/lib/geneTypes.test.ts`

**Interfaces:**
- Produces: `GeneTypeSummary` (mirrors Task 3's dict), `GeneTypeSelection = { classes: string[]; sets: string[]; species: string | null }`, `EMPTY_SELECTION`, `proteinCodingOnly(summary): GeneTypeSelection` (every class present except `protein_coding`, `unannotated`, `exogenous`; sets `mt`, `ribo`, `predicted` when present), `selectionIsEmpty(sel)`, `excludeGenesBody(namesText, patternsText, sel): { gene_names: string[] | null; patterns: string[] | null; types: GeneTypeSelection | null } | { error: string }` (error text: `Provide gene names, a regex pattern or a gene type.`), `summaryLine(selection)` (`Removes 10,912 genes, keeps 21,373.` with an added clause `Names and patterns add 7 beyond the types (Rps6ka1, ...).` when nonzero), `mitoWarning(sel): string | null`.

- [ ] **Step 1: Write the failing tests** for each export, including: the preset on a cryten-shaped summary leaves `exogenous` out; an empty selection sends `types: null`; the parse of names and patterns matches today's ScanpyModal parse (newline-split names, comma-split patterns, blanks dropped).
- [ ] **Step 2: Run** `npx vitest run src/lib/geneTypes.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `feat(exclude genes): selection, preset and request rules for gene types`.

### Task 6: The modal panel

**Files:**
- Create: `frontend/src/components/GeneTypeExclusion.tsx`
- Modify: `frontend/src/components/ScanpyModal.tsx` (exclude_genes definition ~215 description text; run parse ~1619 replaced by `excludeGenesBody`; mount beside the other per-function panels; Mark refresh)

**Interfaces:**
- Consumes: Task 5's lib; routes from Task 4; `appendDataset`, `API_BASE`, `refreshSchema`.
- Produces: `GeneTypeExclusion({ selection, onChange, namesText, patternsText, onMarked })`; the selection state lives in `ScanpyModal` (reset when the function or dataset changes) so Run can read it.

- [ ] **Step 1: Implement** the panel per the spec's sketch: header with species and source label; two columns (classes, sets) of checkboxes with counts, set descriptions as `title`; sets with `computed_by === 'skopia'` marked "computed"; species `<select>` when `species` is null; *Protein-coding only* and *Clear* buttons; `summaryLine`; `mitoWarning` in `#e9a23b`; the column-name field (default `analysis_genes`) and *Mark* button. Summary fetch debounced 300 ms on selection, names and patterns; a 400 shows its detail in the panel (Review Focus 2). After *Mark* succeeds: `refreshSchema()` and update `scanpyActionHistory` as Run's success path does, since the boolean-column list refetches on that key.
- [ ] **Step 2: Run** `npx tsc --noEmit` and `npx vitest run` → clean, PASS.
- [ ] **Step 3: Browser check** on an isolated stack (backend `cd backend && "/Users/pcahan/Dropbox (Personal)/Code/xcell/.pixi/envs/pyscn/bin/python" -m uvicorn skopia.main:app --port 8100`; frontend `SKOPIA_BACKEND=http://127.0.0.1:8100 npx vite --port 5273 --strictPort`): toy dataset, the Grosswendt demo (`~/Dropbox (Personal)/Code/cscb_course/cscb2026/data/ad_Grosswendt_demo.h5ad`) and the cryten file (`/Users/pcahan/CahanLab Dropbox/Patrick Cahan/PC/PC/projects/SJD/analysis/claude_pipeline/runs/pijuan_small/qc/qc.h5ad`). Each: counts appear, the preset's total equals the genes removed by Run, *Mark* adds a pill that the PCA gene subset lists. Record the numbers with their dataset.
- [ ] **Step 4: Commit** `feat(exclude genes): gene-type panel in Exclude Genes`.

### Task 7: Records

**Files:**
- Modify: `CHANGELOG.md` (under `## [Unreleased]`), the main checkout's `CLAUDE.md` (local only, not in git: a paragraph under Backend conventions on `gene_types.py`, the shipped table's row rule, file-annotation precedence, the one-mask rule and Mark never overwriting)

- [ ] **Step 1:** Changelog feature entry naming where it lives, what *Protein-coding only* ticks, the file-annotation rule, and the Task 6 numbers with their datasets.
- [ ] **Step 2:** Commit `docs: changelog for excluding genes by type`.
