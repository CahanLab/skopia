"""Build the shipped gene-type tables (`gene_types_{human,mouse}.tsv.gz`).

Exclude Genes removes or marks genes by GENCODE biotype class and by named
sets (skopia/gene_types.py). It needs each gene's `gene_type` and chromosome
offline, from the same releases as the symbol maps and CNV positions, so a
type never disagrees with them about which gene a name means.

    pixi run -e dev python skopia/data/build_gene_types.py

Sources, per species, are the two GENCODE releases in build_gene_symbol_maps
`SOURCES`: the 10x 2020-A reference (GENCODE M23 mouse, v32 human) and the
newest (M39, v50).

Columns: gene_id (version stripped), symbol, gene_type (GENCODE's
`gene_type` attribute), chromosome (as written, `chr` prefix kept).

Row rule: one row per distinct (gene id, symbol) pair. A gene renamed
between the releases has two rows, its newest symbol first and its retired
one after every current symbol, so a lookup that takes a symbol's first row
prefers the gene that holds the name now. Every row of a gene carries the
newest release's type and chromosome: a gene's type should not depend on
which of its names the dataset used. Unlike the position tables, scaffold
genes are kept, since a type does not need a karyogram.
"""
from __future__ import annotations

import gzip
import sys
import urllib.request
from collections.abc import Iterable
from pathlib import Path

from build_gene_symbol_maps import SOURCES, _attr

OUT_DIR = Path(__file__).resolve().parent


def harvest_types(lines: Iterable[str]) -> dict[str, tuple[str, str, str]]:
    """gene_id (no version) -> (symbol, gene_type, chromosome) from GTF gene lines."""
    out: dict[str, tuple[str, str, str]] = {}
    for line in lines:
        if line.startswith('#'):
            continue
        parts = line.split('\t', 9)
        if len(parts) < 9 or parts[2] != 'gene':
            continue
        gid = _attr(parts[8], 'gene_id')
        name = _attr(parts[8], 'gene_name')
        gtype = _attr(parts[8], 'gene_type')
        if not gid or not name or not gtype:
            continue
        out[gid.split('.', 1)[0]] = (name, gtype, parts[0])
    return out


def merge_releases(releases: list[dict[str, tuple[str, str, str]]]) -> list[tuple[str, str, str, str]]:
    """Rows (gene_id, symbol, gene_type, chromosome) from releases given oldest first."""
    newest: dict[str, tuple[str, str, str]] = {}
    for rel in releases:
        newest.update(rel)
    rows = [(gid, sym, gtype, chrom) for gid, (sym, gtype, chrom) in sorted(newest.items())]
    seen = {(gid, sym) for gid, sym, _, _ in rows}
    retired: list[tuple[str, str, str, str]] = []
    for rel in reversed(releases):
        for gid in sorted(rel):
            sym = rel[gid][0]
            if (gid, sym) in seen:
                continue
            seen.add((gid, sym))
            _, gtype, chrom = newest[gid]
            retired.append((gid, sym, gtype, chrom))
    return rows + retired


def _fetch(url: str) -> dict[str, tuple[str, str, str]]:
    with urllib.request.urlopen(url, timeout=600) as resp, gzip.open(resp, 'rt') as fh:
        return harvest_types(fh)


def main() -> int:
    for species, sources in SOURCES.items():
        releases = []
        for url, label in sources:
            print(f'{species}: fetching {label} ...', flush=True)
            got = _fetch(url)
            print(f'  {len(got):,} genes', flush=True)
            releases.append(got)
        rows = merge_releases(releases)
        path = OUT_DIR / f'gene_types_{species}.tsv.gz'
        with gzip.open(path, 'wt', compresslevel=9) as fh:
            fh.write('gene_id\tsymbol\tgene_type\tchromosome\n')
            for row in rows:
                fh.write('\t'.join(row) + '\n')
        ids = {r[0] for r in rows}
        coding = {r[0] for r in rows if r[2] == 'protein_coding'}
        print(f'{species}: wrote {len(rows):,} rows, {len(ids):,} gene ids, '
              f'{len(coding):,} protein-coding ids -> {path.name} '
              f'({path.stat().st_size / 1e6:.1f} MB)\n', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
