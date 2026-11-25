# Exclude genes by type (Analyze → Preprocess → Exclude Genes)

Date: 2026-11-25. Status: design for approval.

## Intent

Patrick often runs downstream analysis on known protein-coding genes only,
without pseudogenes, predicted gene models, ribosomal and mitochondrial genes
or lncRNAs. Exclude Genes today removes genes by exact name or by a regex on
the gene names, so "protein-coding only" cannot be said; it can only be
approximated with patterns. The SJD pipeline (`cryten`, under
`CahanLab Dropbox/Patrick Cahan/PC/PC/projects/SJD/analysis/claude_pipeline/`)
solved this with a per-genome annotation table: each gene's GTF biotype,
grouped into coarse classes, plus named gene sets defined by symbol pattern,
chromosome or biotype. This design brings that to skopia.

## Goals

1. Exclude Genes offers gene types to remove: coarse classes from the GENCODE
   biotype and named sets that cut across classes. Each shows how many of the
   dataset's genes it holds, and the modal shows how many genes the current
   choice removes before anything runs.
2. The removal is the existing operation (genes leave the matrix), recorded
   and exported like the name and pattern removals.
3. The same choice can instead be written to `.var` without removing anything:
   the type annotation plus one boolean column naming the genes that pass, so
   the HVG and PCA gene-mask pills can restrict an analysis to them while every
   gene stays plottable and searchable (the SJD approach).
4. Works offline, for human and mouse, on any dataset whose genes are Ensembl
   ids or symbols of either species' 10x reference or a recent GENCODE release.
5. A file that already carries a type annotation (the SJD pipeline's `cryten`
   output) is excluded by its own annotation, which came from the GTF of the
   data's actual reference; the GENCODE tables serve files without one.

## Non-goals

- A user-supplied GTF (option 3 of the approaches). Possible later as a field
  on top of this.
- Species other than human and mouse.
- Per-cell QC scores for the named sets (SJD's `pct_45S_ribo` and the like).
  Calculate QC Metrics already takes boolean `.var` columns.
- Changing what the existing name and pattern fields do.

## Anti-goals

- Biotype alone presented as "protein-coding only". In Ensembl 98 mouse (the
  SJD table, `mouse_GRCm38_ens98.tsv.gz`), 2,090 of the 21,926 protein-coding
  genes match SJD's `predicted` pattern (1,403 Gm, 526 Rik), and the ribosomal
  protein (90), mitochondrial (13) and histone (114) genes are protein-coding
  too. A tool that offered only the biotype would keep most of what Patrick
  wants gone.
- A gene silently removed because it was not in the annotation. Reporters and
  transgenes (tdTomato, GFP, Cre) and symbols the releases do not know are a
  visible row of their own, not ticked by default.
- A second annotation source that can disagree with the shipped symbol maps
  and CNV positions.

## Approaches

1. **Build from skopia's own GENCODE releases (chosen).** A build script
   writes `gene_types_{human,mouse}.tsv.gz` from the same two releases per
   species the symbol maps and CNV positions use (`SOURCES` in
   `build_gene_symbol_maps.py`): the 10x 2020-A release (GENCODE M23 mouse,
   v32 human) and the newest (M39, v50), newest winning. Offline and
   consistent with the other shipped tables; costs one unattended download and
   parse (about 50 minutes for the position tables) and about 1 MB per species
   in the repo.
2. Copy SJD's built tables (Ensembl 98 mouse, Ensembl 93 human). Quickest, but
   one release per species, the human one older than the 10x reference, and a
   second annotation source.
3. Read the user's own GTF, as `annotate_genes.sh` does. Exact for the data's
   reference, but needs the file each time and a picker in the modal.

Patrick chose approach 1 and option 3 of the behaviors (remove, and also mark
without removing). For a file with its own annotation he chose that
annotation over the tables, with *Mark* never overwriting a column.

## Design

### Shipped table

`backend/skopia/data/build_gene_types.py` (stdlib, like the others) reads
the gene lines of the four GTFs in `SOURCES` and writes, per species,
`gene_types_{species}.tsv.gz` with columns `gene_id` (version stripped),
`symbol`, `gene_type` (GENCODE's `gene_type` attribute), `chromosome`
(as written, `chr` prefix kept). Every chromosome and scaffold is kept: a type
does not need a karyogram. The script records its sources in its docstring,
as the others do.

**Both releases' symbols are kept.** One row per distinct (gene id, symbol)
pair, so a gene renamed between M23 and M39 has two rows. The shipped symbol
map keeps only the newest name, and against it 1,403 of the Grosswendt demo's
21,133 symbols (mouse, no id column) do not match, 766 of them outside the
`predicted` pattern (Fam46d, Olfr484, Atp5j2, Hist2h2be): 10x 2020-A names
that M39 renamed. *My call:* every row of a gene carries the newest release's
`gene_type` and chromosome, since the newer biotype is the better knowledge
and a gene's type should not depend on which of its names the dataset used.
(The CNV position table has the same old-name gap; out of scope here.)
*My call:* a new table and script rather than a column added to the position
tables, because the position table drops scaffolds and CNV's loader parses it
by position.

### Annotation module

`backend/skopia/gene_types.py`, pure like the other analysis modules: takes
gene names (and optionally ids), returns arrays and dicts, never touches the
adaptor.

- `CLASSES`: GENCODE biotype → coarse class, ported from SJD's `gene_class`
  map: `protein_coding`, `lncRNA` (including TEC), `pseudogene`, `small_rna`,
  `ig_tr`; any other biotype is `other`; a gene not found is `unannotated`.
- `SETS[species]`: named sets ported from SJD's `resources/genesets/
  {mouse,human}.yaml`, each with its description, defined by any of
  `pattern` (regex on the symbol), `genes`, `chrom`, `biotype`, a gene being
  in the set if it meets any condition: `mt`, `ribo`, `mito_ribo`, `rrna`,
  `hb`, `histone`, `x_linked`, `y_linked`, `sex`, `cell_cycle_s`,
  `cell_cycle_g2m`, `stress`, `predicted`, and for mouse `45S_ribo`. The
  descriptions travel with them and are shown in the modal. SJD's chromosome
  names (`MT`, `chrM`, `M`) cover GENCODE's `chrM`.
- `annotate(names, ids, species) -> GeneTypeAnnotation`: per gene, `gene_type`,
  `gene_class`, and set membership; plus how each gene matched.
- Matching, per gene, first hit wins: the `.var` id column (`gene_ids` or
  `gene_id`, as 10x loading writes) with any version stripped; the var name as
  an Ensembl id; the var name as a symbol; the upper-cased symbol only when the
  table's species is human (mouse symbols are case-sensitive in practice:
  `Mt-` is not `mt-`). A symbol shared by several gene ids takes the first row,
  as `cnv.load_positions` does; a current symbol wins over a retired one.
- *My call:* a `pattern` or `genes` condition matches if **either** the
  dataset's own name or the matched table symbol meets it. The dataset's name
  keeps `predicted` and `ribo` working for unannotated genes; the table
  symbol makes them work on a dataset indexed by Ensembl ids, where the name
  is `ENSMUSG...`.

### A file's own annotation

When `.var` has a `gene_class` column that is not boolean (the SJD pipeline
writes one, with `biotype`, `chrom`, `exogenous`, `feature_ok` and one boolean
column per set; checked on `runs/pijuan_small/qc/qc.h5ad`), the file is the
source:

- Classes are the values of `.var['gene_class']` as found, including
  cryten's `exogenous` and `unannotated`.
- A named set the file has as a boolean `.var` column of the same name is
  read from that column. *My call:* a set it lacks is computed as in the
  table path, on the file's names (and its `chrom` and `biotype` columns when
  present), and the modal marks it as computed by skopia, so the offered list
  does not shrink on an older cryten file.
- The modal header names the source: "this file's annotation (gene_class and
  N set columns)" or "GENCODE M23 + M39".
- The summary and the run record which source they used.

### Adaptor and routes

- `DataAdaptor.gene_type_summary(species=None, selection=None)`: species from
  `guess_species` unless given; returns the species, release labels, match
  counts (`ensembl_id`, `symbol`, `unmatched`), per class and per set the
  number of the dataset's genes and up to 8 example names, and, when a
  selection is given, how many genes it removes and how many remain, with
  examples. The selection includes the name and pattern fields, so the total
  is exactly what Run removes, and the summary also reports how many genes
  the names and patterns add beyond the ticked types, with examples (the
  stock `^Rps` takes the S6 kinases, which the `ribo` set leaves out on
  purpose). `GET`-style semantics but served as `POST
  /api/scanpy/exclude_genes/types` because the selection is a body.
- `run_exclude_genes` gains `types: {classes: [...], sets: [...],
  species: str | None} | None`. The removed mask is the union of the name
  matches, the pattern matches and the genes in any ticked class or set.
  The `exclude_genes` action records `types` and the **full list** of genes
  the types removed (`type_removed_genes`), so the record and code export do
  not depend on the table the export runs with.
- `DataAdaptor.annotate_gene_types(types, column, gene_names=None,
  patterns=None, species=None)` writes the boolean `.var[column]`: False for
  exactly the genes the same arguments would make `run_exclude_genes` remove,
  True for the rest. It also writes `.var['gene_type']` and
  `.var['gene_class']` (categorical) **only when absent**: Mark never
  overwrites an existing column, so a cryten file keeps its own. Refuses a
  `column` that exists unless `overwrite=True` (which applies to that column
  only), and refuses names of columns skopia owns (`highly_variable*`). Logs
  `annotate_gene_types`. Route `POST /api/scanpy/annotate_gene_types`.
- Request models spell the full union of what the adaptor accepts (the
  CLAUDE.md rule on narrowing). Errors map as usual: an unsupported species or
  an unknown class or set name is a 400.

### Code export

- `exclude_genes`: unchanged when `types` is absent; with `types`, the emitted
  code adds `_drop = _drop | adata.var_names.isin([...])` over the recorded
  `type_removed_genes`. Fidelity stays EXACT. *My call:* a literal list over a
  call into skopia, because an export must reproduce the run even after the
  shipped tables are rebuilt, and a 10x mouse dataset loses about 10,000 names
  under "protein-coding only", about 100 kB of script.
- `annotate_gene_types`: fidelity SKOPIA, emitting
  `xa.annotate_gene_types(...)` with the recorded arguments, since the
  per-gene annotation is too large to inline and the step does not change the
  matrix. Both need a `REGISTRY` entry or `test_codegen` fails.

### Modal

A `GeneTypeExclusion` component mounted in `ScanpyModal` under the existing
fields when `selectedFunction === 'exclude_genes'`, the way `HvgPreviewPanel`
is mounted for HVG. Sketch:

```
By gene type          mouse · GENCODE M23 + M39 · 31,842 of 32,285 genes matched
  Class (GENCODE biotype)                 Named sets (any class)
  [ ] protein_coding      21,503          [x] mt  mitochondrial genome         13
  [x] lncRNA               6,120          [x] ribo  ribosomal proteins        103
  [x] pseudogene           2,004          [x] predicted  Gm, Rik, clones    1,980
  [x] small_rna              310          [ ] hb  hemoglobin                    8
  [x] ig_tr                   94          [ ] histone                         114
  [x] other                   40          [ ] ... (each with its description on hover)
  [ ] unannotated            443  e.g. tdTomato, Cre, Gm52931
  Preset: [Protein-coding only]  [Clear]
  Removes 10,912 genes, keeps 21,373.
  Mark instead: write the kept genes to .var as [analysis_genes] [Mark]
```

- The counts and the removal total come from the summary route, refetched
  (debounced) as boxes change; numbers in the sketch are illustrative.
- *Protein-coding only* ticks every class except `protein_coding` and
  `unannotated`, plus the sets `mt`, `ribo` and `predicted`: the list in
  Patrick's request. *My call:* `ig_tr` is ticked by it, since those genes are
  not GENCODE protein-coding; immunology users can untick it. On a cryten
  file the preset leaves `exogenous` unticked, like `unannotated`: reporters
  and selection cassettes are not among the types the request names.
- The preset leaves the name and pattern fields alone; the "names and
  patterns add N genes" line shows when they reach past the types.
- *My call:* nothing is ticked when the modal opens, so the existing pattern
  preset and a type choice never combine by surprise; the preset button is one
  click.
- The modal's Run removes the union of names, patterns and ticked types. A Run
  with all three empty keeps today's message ("Provide at least one gene name
  or regex pattern", reworded to include types).
- *Mark* runs `annotate_gene_types` with the same names, patterns and ticked
  types as Run and the named column (default `analysis_genes`), then refreshes
  the `.var` column lists so the new pill appears in HVG and PCA.
- A note under the mt row when it is ticked: removing mitochondrial genes
  before Filter Cells means the % mito threshold can no longer be used.
- An unknown species (neither table matches) shows a species picker; a species
  with no table shows why the section is unavailable.

### After a removal

The existing post-removal path applies unchanged: `_normalized_adata` reset,
UCell rank cache reset, gene mask regeneration, schema and layer refreshes in
`ScanpyModal` (the `exclude_genes` entries in its allowlists are already
there).

## Tests

- `gene_types.py`: class mapping, each matching path (id column with version,
  var name as id, symbol, a retired 10x symbol, human upper-case fallback,
  mouse no fallback), sets by pattern, genes, chromosome and biotype,
  `unannotated` genes still caught by pattern sets, an id-indexed dataset
  caught by the table symbol. Against a small fixture table, not the shipped
  one.
- A file's own annotation: classes from `gene_class`, sets from same-named
  boolean columns, a missing set computed, and Mark leaving `gene_class` and
  `gene_type` untouched.
- Shipped tables: present, header as specified, and the protein-coding count
  per species within a stated range of GENCODE's published count.
- Adaptor: removal by types alone and combined with names and patterns,
  asserting both the returned dict and the resulting `var_names`; the record
  holds the full removed list; `annotate_gene_types` marks exactly the genes
  the run would remove, writes the type columns only when absent and refuses
  an existing kept column; the summary total equals the run's count.
- Codegen: the exported script, run on the same input, drops exactly the genes
  the run dropped.
- Routes: the selection dict passes the request model (the 422 trap).
- Browser: the toy dataset, the Grosswendt demo (mouse symbols) and a cryten
  file (`runs/pijuan_small/qc/qc.h5ad`) through the modal: counts appear, the
  preset gives a removal total, Run removes it, Mark adds a pill usable in
  PCA.

## Left to the builder

Component layout inside the modal within the inline-style palette; the
debounce interval; whether the summary returns example names per category in
one call or on hover; the exact upper bound of the shipped-table count check.
