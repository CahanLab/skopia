"""Gene types: each gene's GENCODE class and its named-set memberships.

Exclude Genes removes, or marks in ``.var``, genes by coarse class
(``protein_coding``, ``lncRNA``, ...) and by named sets that cut across classes
(``mt``, ``ribo``, ``predicted``, ...). Biotype alone cannot say "protein-coding
only": in mouse about 2,000 protein-coding genes are Gm / Rik models, and the
ribosomal, mitochondrial and histone genes are protein-coding too.

Two sources:

- the shipped ``data/gene_types_{species}.tsv.gz`` (``build_gene_types.py``,
  GENCODE 10x 2020-A + newest), matched by Ensembl id or symbol;
- the file's own annotation, when ``.var`` carries a non-boolean
  ``gene_class`` column (the SJD pipeline, cryten, writes one from the GTF of
  the data's actual reference). It wins: it knows the reference, the tables
  only guess it.

The classes and sets come from the SJD pipeline's ``resources/genesets``
(copied to ``data/gene_type_sets``). Pure: arrays and frames in, arrays and
dicts out; never touches the adaptor.
"""
from __future__ import annotations

import gzip
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

_DATA = Path(__file__).resolve().parent / 'data'

SPECIES = ('human', 'mouse')
RELEASES = {'mouse': 'GENCODE M23 + M39', 'human': 'GENCODE v32 + v50'}
CLASS_ORDER = ('protein_coding', 'lncRNA', 'pseudogene', 'small_rna', 'ig_tr', 'other', 'unannotated')
UNANNOTATED = 'unannotated'
OTHER = 'other'


def _check_species(species: str) -> None:
    if species not in SPECIES:
        raise ValueError(f"No gene-type table for species '{species}'. Choose one of: {', '.join(SPECIES)}.")


@lru_cache(maxsize=None)
def _read_sets(species: str) -> tuple[dict[str, dict], dict[str, str]]:
    import yaml  # noqa: PLC0415

    with open(_DATA / 'gene_type_sets' / f'{species}.yaml') as fh:
        doc = yaml.safe_load(fh)
    sets = {}
    for name, d in doc['sets'].items():
        sets[str(name)] = {
            'description': ' '.join(str(d.get('description', '')).split()),
            'pattern': d.get('pattern'),
            'genes': [str(g) for g in d.get('genes') or []],
            'chrom': [str(c) for c in d.get('chrom') or []],
            'biotype': [str(b) for b in d.get('biotype') or []],
        }
    classes = {str(b): str(c) for c, biotypes in doc['gene_class'].items() for b in biotypes}
    return sets, classes


def load_sets(species: str) -> tuple[dict[str, dict], dict[str, str]]:
    """(set name -> definition, biotype -> class) for one species."""
    _check_species(species)
    return _read_sets(species)


@dataclass
class GeneTable:
    """Rows of a gene-type table and the lookups into them."""
    gene_id: list[str]
    symbol: list[str]
    gene_type: list[str]
    chromosome: list[str]
    by_id: dict[str, int]
    by_symbol: dict[str, int]
    by_upper: dict[str, int]


def _read_table(path: Path) -> GeneTable:
    gene_id: list[str] = []
    symbol: list[str] = []
    gene_type: list[str] = []
    chromosome: list[str] = []
    by_id: dict[str, int] = {}
    by_symbol: dict[str, int] = {}
    by_upper: dict[str, int] = {}
    with gzip.open(path, 'rt') as fh:
        if fh.readline().rstrip('\n') != 'gene_id\tsymbol\tgene_type\tchromosome':
            raise ValueError(f'{path.name} has an unexpected header')
        for i, line in enumerate(fh):
            gid, sym, gtype, chrom = line.rstrip('\n').split('\t')
            gene_id.append(gid)
            symbol.append(sym)
            gene_type.append(gtype)
            chromosome.append(chrom)
            # First row wins everywhere: the table lists every current symbol
            # before any retired one, so a name a gene holds now beats a name
            # another gene gave up.
            by_id.setdefault(gid, i)
            by_symbol.setdefault(sym, i)
            by_upper.setdefault(sym.upper(), i)
    return GeneTable(gene_id, symbol, gene_type, chromosome, by_id, by_symbol, by_upper)


@lru_cache(maxsize=None)
def _shipped_table(species: str) -> GeneTable:
    path = _DATA / f'gene_types_{species}.tsv.gz'
    if not path.exists():
        raise ValueError(f'The {species} gene-type table is missing from this install ({path.name}).')
    return _read_table(path)


def load_table(species: str, path: Path | str | None = None) -> GeneTable:
    """The species' gene-type table; the shipped one (cached) unless ``path`` is given."""
    _check_species(species)
    if path is None:
        return _shipped_table(species)
    return _read_table(Path(path))


@dataclass
class GeneTypeAnnotation:
    """Per gene: GENCODE type and class, and membership in each named set."""
    gene_type: list[str | None]
    gene_class: list[str]
    sets: dict[str, np.ndarray] = field(default_factory=dict)
    set_source: dict[str, str] = field(default_factory=dict)  # 'file' or 'skopia'
    source: dict[str, Any] = field(default_factory=dict)
    matched: dict[str, int] = field(default_factory=dict)


def _strip_version(gene_id: str) -> str:
    return gene_id.split('.', 1)[0]


def _set_mask(d: dict, pattern_labels: pd.Series, gene_labels: list[pd.Series],
              chrom: pd.Series | None, biotype: pd.Series | None) -> np.ndarray:
    """A gene is in a set if any of its conditions holds.

    ``pattern`` tests one label per gene (for a table source, the gene's
    current symbol when the table knows it, else the dataset's name);
    ``genes`` tests every label given, since the curated lists carry old and
    new symbols alike.
    """
    m = np.zeros(len(pattern_labels), dtype=bool)
    if d.get('pattern'):
        # re.search, not Series.str.contains: the same matching, without
        # pandas' warning about the capture group in `predicted`.
        rx = re.compile(d['pattern'])
        m |= np.fromiter((isinstance(v, str) and rx.search(v) is not None for v in pattern_labels),
                         dtype=bool, count=len(pattern_labels))
    if d.get('genes'):
        for s in gene_labels:
            m |= s.isin(d['genes']).to_numpy(dtype=bool)
    if d.get('chrom') and chrom is not None:
        m |= chrom.isin(d['chrom']).to_numpy(dtype=bool)
    if d.get('biotype') and biotype is not None:
        m |= biotype.isin(d['biotype']).to_numpy(dtype=bool)
    return m


def annotate_from_table(names, ids, species: str, table: GeneTable | None = None) -> GeneTypeAnnotation:
    """Annotate genes from a gene-type table.

    Per gene, first hit wins: the ``.var`` id column (``ids``, version
    stripped); the name as an Ensembl id; the name as a symbol; for human
    only, the upper-cased name (mouse symbols are case-sensitive in practice:
    ``Mt-`` is not ``mt-``).
    """
    sets_def, class_of = load_sets(species)
    if table is None:
        table = load_table(species)
    names = [str(n) for n in names]
    n = len(names)
    id_list = [None] * n if ids is None else [None if v is None or pd.isna(v) else str(v) for v in ids]
    rows: list[int | None] = []
    matched = {'ensembl_id': 0, 'symbol': 0, 'file': 0, 'unmatched': 0}
    for name, gid in zip(names, id_list):
        row = table.by_id.get(_strip_version(gid)) if gid else None
        how = 'ensembl_id'
        if row is None and name.startswith('ENS'):
            row = table.by_id.get(_strip_version(name))
        if row is None:
            how = 'symbol'
            row = table.by_symbol.get(name)
            if row is None and species == 'human':
                row = table.by_upper.get(name.upper())
        matched[how if row is not None else 'unmatched'] += 1
        rows.append(row)

    gene_type = [None if r is None else table.gene_type[r] for r in rows]
    gene_class = [UNANNOTATED if t is None else class_of.get(t, OTHER) for t in gene_type]
    # The current symbol of each matched gene: a pattern judges the gene by
    # its name now, not by the 10x 2020-A placeholder (Gm38394 is Zbed6 in
    # M39), and on an id-indexed dataset by its symbol rather than its id.
    # An unmatched gene keeps its own name.
    current = [None if r is None else table.symbol[table.by_id[table.gene_id[r]]] for r in rows]
    sym = pd.Series(current, dtype=object)
    pattern_labels = pd.Series([c if c is not None else n for c, n in zip(current, names)], dtype=object)
    chrom = pd.Series([None if r is None else table.chromosome[r] for r in rows], dtype=object)
    biotype = pd.Series(gene_type, dtype=object)
    name_s = pd.Series(names, dtype=object)
    sets = {k: _set_mask(d, pattern_labels, [name_s, sym], chrom, biotype) for k, d in sets_def.items()}
    return GeneTypeAnnotation(
        gene_type=gene_type,
        gene_class=gene_class,
        sets=sets,
        set_source={k: 'skopia' for k in sets},
        source={'kind': 'gencode', 'label': RELEASES[species], 'species': species},
        matched=matched,
    )


# A missing class written out as text: `.astype(str)`, a common fix for an
# h5ad write error, turns NaN into 'nan' and None into 'None'.
_MISSING_TEXT = {'', 'nan', 'none', 'na', '<na>', 'null'}


def _is_missing(v: Any) -> bool:
    return v is None or (not isinstance(v, str) and pd.isna(v)) or str(v).strip().lower() in _MISSING_TEXT


def _is_bool_column(s: pd.Series) -> bool:
    return pd.api.types.is_bool_dtype(s.dtype)


def annotate_from_var(var: pd.DataFrame, names, species: str | None) -> GeneTypeAnnotation | None:
    """Annotate genes from the file's own ``gene_class`` and set columns.

    None unless ``var`` has a non-boolean ``gene_class`` column. Classes are
    read as found (cryten's ``exogenous`` included); a missing value is
    ``unannotated``. A named set the file holds as a boolean column of the
    same name is read from it; a set it lacks is computed from the file's
    names (and its ``chrom`` / ``biotype`` columns when present), so an older
    cryten file still offers every set. With no species, only the file's own
    set columns are offered.
    """
    if 'gene_class' not in var.columns or _is_bool_column(var['gene_class']):
        return None
    names = [str(x) for x in names]
    cls = var['gene_class']
    gene_class = [UNANNOTATED if _is_missing(v) else str(v) for v in cls.tolist()]
    if 'biotype' in var.columns:
        gene_type = [None if pd.isna(v) else str(v) for v in var['biotype'].tolist()]
    else:
        gene_type = [None] * len(names)

    if species is not None:
        sets_def, _ = load_sets(species)
    else:
        sets_def = {}
        for sp in SPECIES:
            for k, d in load_sets(sp)[0].items():
                sets_def.setdefault(k, d)
    name_s = pd.Series(names, dtype=object)
    chrom = var['chrom'].astype(object).reset_index(drop=True) if 'chrom' in var.columns else None
    if chrom is not None:
        chrom = chrom.map(lambda v: None if pd.isna(v) else str(v))
    biotype = pd.Series(gene_type, dtype=object) if 'biotype' in var.columns else None

    sets: dict[str, np.ndarray] = {}
    set_source: dict[str, str] = {}
    n_file_sets = 0
    for k, d in sets_def.items():
        if k in var.columns and _is_bool_column(var[k]):
            # na_value: a nullable-boolean column may hold <NA>; it is not in the set
            sets[k] = var[k].to_numpy(dtype=bool, na_value=False)
            set_source[k] = 'file'
            n_file_sets += 1
        elif species is not None:
            sets[k] = _set_mask(d, name_s, [name_s], chrom, biotype)
            set_source[k] = 'skopia'

    n_un = sum(c == UNANNOTATED for c in gene_class)
    plural = '' if n_file_sets == 1 else 's'
    return GeneTypeAnnotation(
        gene_type=gene_type,
        gene_class=gene_class,
        sets=sets,
        set_source=set_source,
        source={'kind': 'file',
                'label': f"this file's annotation (gene_class and {n_file_sets} set column{plural})",
                'species': species},
        matched={'ensembl_id': 0, 'symbol': 0, 'file': len(names) - n_un, 'unmatched': n_un},
    )


def class_names(ann: GeneTypeAnnotation) -> list[str]:
    """Every class this annotation can offer: the GENCODE ones, then the file's own."""
    extra = sorted({c for c in ann.gene_class if c not in CLASS_ORDER})
    return list(CLASS_ORDER) + extra


def removal_mask(ann: GeneTypeAnnotation, classes, sets) -> np.ndarray:
    """Genes in any of ``classes`` or ``sets``."""
    valid_classes = class_names(ann)
    unknown = [c for c in classes if c not in valid_classes]
    if unknown:
        raise ValueError(f"Unknown gene class {', '.join(map(repr, unknown))}. "
                         f"Choose from: {', '.join(valid_classes)}.")
    unknown = [s for s in sets if s not in ann.sets]
    if unknown:
        raise ValueError(f"Unknown gene set {', '.join(map(repr, unknown))}. "
                         f"Choose from: {', '.join(ann.sets)}.")
    mask = np.isin(np.asarray(ann.gene_class, dtype=object), list(classes)) if classes else \
        np.zeros(len(ann.gene_class), dtype=bool)
    for s in sets:
        mask = mask | ann.sets[s]
    return mask
