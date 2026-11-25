"""The shipped gene-type tables and the script that builds them.

`build_gene_types.py` keeps every symbol either GENCODE release gave a gene,
so a 10x 2020-A dataset whose names M39 retired still finds its type, and
gives every row of a gene the newest release's type and chromosome.
"""
from __future__ import annotations

import gzip
import importlib.util
import sys
from pathlib import Path

import pytest

_DATA = Path(__file__).resolve().parent.parent / 'skopia' / 'data'
sys.path.insert(0, str(_DATA))  # the script imports build_gene_symbol_maps
_SPEC = importlib.util.spec_from_file_location('build_gene_types', _DATA / 'build_gene_types.py')
build = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(build)


def test_harvest_reads_gene_lines_only():
    attrs = 'gene_id "ENSMUSG00000000001.5"; gene_type "protein_coding"; gene_name "Gnai3";'
    lines = [
        '#description: a comment line\n',
        f'chr3\tHAVANA\tgene\t108014596\t108053462\t.\t-\t.\t{attrs}\n',
        f'chr3\tHAVANA\ttranscript\t108014596\t108053462\t.\t-\t.\t{attrs} transcript_id "T1";\n',
        'JH584295.1\tENSEMBL\tgene\t1\t100\t.\t+\t.\t'
        'gene_id "ENSMUSG00000095742.2"; gene_type "protein_coding"; gene_name "Gm16367";\n',
    ]
    got = build.harvest_types(lines)
    assert got == {
        'ENSMUSG00000000001': ('Gnai3', 'protein_coding', 'chr3'),
        'ENSMUSG00000095742': ('Gm16367', 'protein_coding', 'JH584295.1'),
    }


def test_merge_keeps_old_symbols_with_the_newest_type():
    m23 = {
        'ID1': ('Olfr484', 'protein_coding', 'chr7'),
        'ID2': ('Gm1', 'lncRNA', 'chr1'),
        'ID3': ('Gone1', 'lncRNA', 'chr2'),
    }
    m39 = {
        'ID1': ('Or5b3', 'protein_coding', 'chr7'),
        'ID2': ('Gm1', 'processed_pseudogene', 'chr1'),
    }
    rows = build.merge_releases([m23, m39])
    assert rows == [
        ('ID1', 'Or5b3', 'protein_coding', 'chr7'),
        ('ID2', 'Gm1', 'processed_pseudogene', 'chr1'),
        ('ID3', 'Gone1', 'lncRNA', 'chr2'),
        ('ID1', 'Olfr484', 'protein_coding', 'chr7'),
    ]


def _read(species):
    path = _DATA / f'gene_types_{species}.tsv.gz'
    if not path.exists():
        pytest.skip(f'{path.name} not built yet (run build_gene_types.py)')
    with gzip.open(path, 'rt') as fh:
        header = fh.readline()
        rows = [line.rstrip('\n').split('\t') for line in fh]
    return header, rows


# GENCODE's published protein-coding counts: about 21,600 mouse (M39) and
# 20,000 human (v50). The bounds leave room for genes only the older release
# carries, not for a parse that drops or doubles a class.
@pytest.mark.parametrize('species,lo,hi', [('mouse', 21_000, 24_000), ('human', 19_000, 21_500)])
def test_shipped_tables(species, lo, hi):
    header, rows = _read(species)
    assert header == 'gene_id\tsymbol\tgene_type\tchromosome\n'
    assert all(len(r) == 4 for r in rows)
    coding = {r[0] for r in rows if r[2] == 'protein_coding'}
    assert lo <= len(coding) <= hi, len(coding)
    if species == 'mouse':
        # 10x 2020-A (M23) names that M39 renamed: both names, one gene id,
        # the current name's row first.
        for old, new in (('Olfr484', 'Or5p60'), ('Hist2h2be', 'H2bc21')):
            hits = [(i, r[0]) for i, r in enumerate(rows) if r[1] in (old, new)]
            assert len(hits) == 2 and hits[0][1] == hits[1][1], (old, new, hits)
            assert rows[hits[0][0]][1] == new
