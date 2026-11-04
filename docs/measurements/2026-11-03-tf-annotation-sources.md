# Transcription factor annotations for human and mouse (survey, 2026-11-03)

Purpose: a TF list to feed the marker-selection *Show only* picker (and any
later bundled gene-set source). The lists built here ship with xcell as
`backend/xcell/data/tf_census/` (`human_codebook_table14.tsv`,
`mouse_tfs.tsv`, `unmapped_human_tfs.tsv`); `build_tf_census.py` beside them
turns the two into the *Transcription factors* gene-set bundles
(`gene_sets/tf_census_{human,mouse}.json`). Edit a table, run the build,
never the JSON.

## Human: use the Codebook update of the Lambert census

- Lambert et al. 2018 (Cell, PMID 29425488), site `humantfs.ccbr.utoronto.ca`,
  list v1.01: 2,765 scanned proteins, 1,639 `Is TF? = Yes`. No release since
  2018 on the site. `TF assessment` for the 1,639: 1,107 known motif, 104
  inferred motif, 428 "likely to be sequence specific TF" (no motif).
- Codebook (Jolma et al., Nature, 5 Aug 2026, doi 10.1038/s41586-026-10798-9,
  PMC13538051) tested 332 of those 428 with five assays (HT-SELEX, GHT-SELEX,
  SMiLE-seq, PBM, ChIP-seq in HEK293). 177 gave motifs; 33 more got motifs
  from newer external data; 1,421 human TFs now have a motif. Re-curation of
  the 155 failures classified 83 as unlikely to be bona fide TFs
  (Supplementary Note 3, Table S6).
- **Supplementary Table 14 ("Updated census of human transcription factors")**
  is the deliverable: the 1,639 Lambert TFs with `TF re-assessment` and
  `Motif status`. Counts in that column: 1,317 known motif, 104 inferred,
  135 likely, 83 unlikely. Dropping the 83 gives **1,556 human TFs**
  (full table in `tf_census/human_codebook_table14.tsv`). The 61 non-tested "likely" TFs stay in.
  Symbols are Lambert-era HGNC: `ARNTL` (now BMAL1), `T` (TBXT), `C11orf95`
  (ZFTA), four `AC0...` clone names; resolve through HGNC aliases before use.
- Sources from the paper: data page `codebook.ccbr.utoronto.ca` (metadata,
  peaks, expert-curated PWMs), Motif Explorer `mex.autosome.org`, GEO
  GSE278858 / GSE280248, Zenodo 15667805 / 17307845 / 18224872. Companion
  papers: GHT-SELEX (Nat Methods, 10.1038/s41592-026-03177-9), dark TFs
  (Nat Commun, 10.1038/s41467-026-75376-z), meSMiLE-seq (Nat Commun,
  10.1038/s41467-026-71387-y), motif benchmarking (Commun Biol,
  10.1038/s42003-025-08909-9), IBIS challenge (Cell Rep,
  10.1016/j.celrep.2026.118025).

## Mouse: no curated census exists; built one

No mouse equivalent of Lambert/Codebook. Candidates checked:

- AnimalTFDB 4.0 (`guolab.wchscu.cn/AnimalTFDB4`): JS-only site behind an
  Aliyun WAF; curl gets a challenge page, so the mouse list (reported ~980
  TFs by the WebSearch summary, unverified) has to be fetched in a browser.
  Family-based DBD scan, not curated.
- TFCheckpoint v2 (human/mouse/rat cross-reference, NAR 2024): host
  `tare.medisin.ntnu.no` refused connections today.
- CIS-BP build 3.10 (`cisbp.ccbr.utoronto.ca/entireDownload.php`,
  TF_Information.zip, 240 MB): Mus_musculus 1,513 TFs (1,280 direct motif,
  361 inferred, 491 none) by DBD scan; human rows are exactly the Lambert
  1,639. Mouse symbols are stale (`Arntl`, `Bcl11B`, Rik names, UniProt IDs).
- TFCat (2009) and the Vaquerizas 2009 census are too old to bother with.

Built list `tf_census/mouse_tfs.tsv` (1,478 genes after step 5):

1. Orthologs of the 1,556 human census TFs through MGI
   `HOM_MouseHumanSequence.rpt` (downloaded 2026-11-03): 1,339 mouse genes;
   267 human TFs have no mouse ortholog (238 are C2H2 ZFs, mostly
   primate-specific KZFPs; the rest are DUX/ARGFX/LEUTX/TPRX-type
   homeodomains, HSFX, and the stale symbols above) —
   `tf_census/unmapped_human_tfs.tsv`, 264 rows after step 5.
2. CIS-BP mouse TFs with no human ortholog at all: 120 added as
   `cisbp_3.10_only_mouse_specific` (91 C2H2 ZF, 28 homeodomain: Rhox, Obox,
   Duxbl, Cphx; 1 HSF).
3. CIS-BP mouse-only genes whose human ortholog Lambert or Codebook judged
   not a TF were dropped (24: Ncoa1/2, Cbfb, Arid2, Baz2a/b, Thap2/4/7/11 …).
4. 16 CIS-BP-only genes whose human ortholog Lambert never scanned are kept
   but tagged `cisbp_3.10_only_human_ortholog_unassessed`; eyeball them
   before trusting (Duxbl1 is real, Afdn/Clip1/Lrrc59/Snx29 are DBD-scan
   noise).
5. (2026-11-04, after review) Steps 1 and 4 had run on the stale Lambert
   symbols, so the human TFs the bundle build later renames through their
   Ensembl IDs never got a mouse row. Re-mapped the ten renamed symbols
   through MGI: BMAL1 → Bmal1 and BMAL2 → Bmal2 added (CIS-BP lists both as
   Arntl/Arntl2), TBXT → T re-filed from unassessed to
   `cisbp_3.10;human_census_ortholog`. ZNF645 (now CBLL2) maps to mouse
   Cbll1 only through an MGI class that also holds human CBLL1 (Hakai, an
   E3 ligase, not a TF), so it was left unmapped. The other six have no
   mouse ortholog. 1,478 rows.

Condition on every count: MGI report and CIS-BP 3.10 as of 2026-11-03;
symbol matching, no sequence-level check.

## Not done

- Zfp* KZFPs: the mouse KRAB-ZFP expansion (~300 genes) is only partly in
  CIS-BP; a mouse-native scan (AnimalTFDB, or a Pfam zf-C2H2 + KRAB scan of
  the GENCODE M-release proteome) would add more.
- HGNC alias resolution for the stale human symbols: the bundle build
  resolves them through their Ensembl IDs against the shipped GENCODE table
  instead (10 renamed, three of them to pseudogene or readthrough symbols:
  CENPBD1P, ZNF705EP, ATF7-NPFF; DUX1, DUX3 and two AC0... clone names have
  no Ensembl gene or symbol and are left out, so the human bundle has
  1,552). The mouse bundle leaves out Chchd2l2, Gm14430 and Zfp1002, absent
  from that table (1,475).
- Mouse brachyury is `T` in the list, as in CIS-BP and the shipped GENCODE
  table; a dataset annotated with `Tbxt` will not match it.
