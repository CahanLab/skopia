"""The transcription-factor census bundles shipped with xcell.

``xcell/data/build_tf_census.py`` turns the two tables under
``xcell/data/tf_census/`` (the Codebook update of the Lambert human census,
and the mouse list derived from it plus CIS-BP) into
``gene_sets/tf_census_{human,mouse}.json``: one *All TFs* set per species
and folders that split it by DNA-binding domain, by motif evidence (human)
and by provenance (mouse). The *Show only* picker and the Library modal read
the JSON, so a symbol Ensembl does not know, a hand edit to the JSON, or a
set that drifted from the table would show up as a silent gap. These tests
pin the files against the tables and the bundled Ensembl symbol tables.
"""
import importlib.util
import json
from pathlib import Path

import pytest

from xcell import gene_set_library, gene_symbols

_SPEC = importlib.util.spec_from_file_location(
    'build_tf_census', Path(gene_set_library.LIBRARY_DIR).parent / 'build_tf_census.py')
btc = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(btc)

DATA = Path(gene_set_library.LIBRARY_DIR)
SPECIES = ['mouse', 'human']


@pytest.fixture(scope='module')
def tables():
    return {sp: gene_symbols.load_table(sp) for sp in SPECIES}


def _bundle(species):
    return json.loads((DATA / f'tf_census_{species}.json').read_text())


def _all(bundle):
    return next(s for s in bundle['sets'] if s['name'].startswith('All TFs') and 'folder' not in s)


def _folders(bundle):
    out: dict[str, list[dict]] = {}
    for s in bundle['sets']:
        if 'folder' in s:
            out.setdefault(s['folder'], []).append(s)
    return out


@pytest.mark.parametrize('species', SPECIES)
def test_the_bundle_is_listed_by_the_library(species):
    ids = {b['id']: b for b in gene_set_library.list_bundles()}
    assert f'tf_census_{species}' in ids
    b = ids[f'tf_census_{species}']
    assert species in b['name'].lower() and b['count'] >= 10


@pytest.mark.parametrize('species', SPECIES)
def test_every_symbol_is_known_to_ensembl(species, tables):
    known = set(tables[species].values())
    unknown = sorted({
        f"{s.get('folder', '-')}/{s['name']}: {g}"
        for s in _bundle(species)['sets'] for g in s['genes'] if g not in known
    })
    assert unknown == []


def test_all_set_sizes_follow_the_source_tables():
    # Human: the 1,639 Lambert TFs in Codebook Supplementary Table 14, minus
    # the 83 re-assessed as unlikely to be sequence-specific TFs (1,556),
    # minus 4 with no Ensembl gene or no Ensembl symbol (DUX1, DUX3, two
    # AC0... clone names). Mouse: the 1,476 rows of mouse_tfs.tsv minus 3
    # absent from the shipped GENCODE table. Both as of 2026-11-03.
    assert len(_all(_bundle('human'))['genes']) == 1552
    assert len(_all(_bundle('mouse'))['genes']) == 1473


@pytest.mark.parametrize('species', SPECIES)
def test_every_grouped_set_is_a_subset_of_all_with_no_duplicates_or_empties(species):
    bundle = _bundle(species)
    universe = set(_all(bundle)['genes'])
    assert len(universe) == len(_all(bundle)['genes'])
    folders = _folders(bundle)
    assert folders, 'no folders'
    for folder, sets in folders.items():
        names = [s['name'] for s in sets]
        assert len(set(names)) == len(names), folder
        for s in sets:
            assert s['genes'], (folder, s['name'])
            assert len(set(s['genes'])) == len(s['genes']), (folder, s['name'])
            assert set(s['genes']) <= universe, (folder, s['name'])


@pytest.mark.parametrize('species', SPECIES)
def test_the_dbd_folder_splits_shared_domains_and_pools_small_families(species):
    folder = next(f for f in _folders(_bundle(species)) if 'DNA-binding domain' in f)
    sets = {s['name']: set(s['genes']) for s in _folders(_bundle(species))[folder]}
    assert len(sets['C2H2 ZF']) > 500 and len(sets['Homeodomain']) > 150
    # 'Homeodomain; POU' puts a gene in both family sets
    pou = 'Pou5f1' if species == 'mouse' else 'POU5F1'
    assert pou in sets['POU'] and pou in sets['Homeodomain']
    other = btc.OTHER_FAMILIES
    assert other in sets
    for name, genes in sets.items():
        if name != other:
            assert len(genes) >= btc.MIN_FAMILY, name


def test_the_human_evidence_folder_partitions_all_tfs():
    bundle = _bundle('human')
    folder = next(f for f in _folders(bundle) if 'motif evidence' in f)
    sets = [set(s['genes']) for s in _folders(bundle)[folder]]
    assert sum(len(s) for s in sets) == len(_all(bundle)['genes'])
    assert set().union(*sets) == set(_all(bundle)['genes'])


def test_the_mouse_provenance_folder_partitions_all_tfs():
    bundle = _bundle('mouse')
    folder = next(f for f in _folders(bundle) if 'provenance' in f)
    sets = {s['name']: set(s['genes']) for s in _folders(bundle)[folder]}
    assert sum(len(s) for s in sets.values()) == len(_all(bundle)['genes'])
    assert 'T' in sets['Ortholog unassessed (review)']   # brachyury: the shipped GENCODE table and CIS-BP both say T, not Tbxt
    assert 'Obox1' in sets['Mouse-specific (CIS-BP)']
    assert 'Sox2' in sets['Human census ortholog']


def test_stale_human_symbols_are_resolved_through_their_ensembl_ids():
    genes = set(_all(_bundle('human'))['genes'])
    assert {'BMAL1', 'TBXT', 'ZNF875'} <= genes
    assert not {'ARNTL', 'T', 'HKR1'} & genes


def test_dropped_symbols_stay_out_and_the_rest_of_the_table_is_in():
    human = set(_all(_bundle('human'))['genes'])
    assert not set(btc.DROPPED['human']) & human
    assert 'ZNF333' in human
    mouse = set(_all(_bundle('mouse'))['genes'])
    assert not set(btc.DROPPED['mouse']) & mouse
    assert {'Sox2', 'Hoxd13', 'Rhox5'} <= mouse


@pytest.mark.parametrize('species', SPECIES)
def test_the_shipped_bundle_is_what_the_build_produces(species, tables):
    assert _bundle(species) == btc.build(species, btc.read_rows(species), tables[species])


def test_the_build_names_a_symbol_the_table_does_not_know():
    table = {'ENSG00000000001': 'KNOWN'}
    rows = [
        {'symbol': 'KNOWN', 'ensembl_id': 'ENSG00000000001', 'dbd': 'bHLH', 'evidence': 'Known motif'},
        {'symbol': 'NOTAGENE', 'ensembl_id': 'ENSG00000000002', 'dbd': 'bHLH', 'evidence': 'Known motif'},
    ]
    assert btc.problems('human', rows, table) == ['human: NOTAGENE (ENSG00000000002) is not in the Ensembl table']
    with pytest.raises(ValueError, match='NOTAGENE'):
        btc.build('human', rows, table)


def test_the_build_leaves_out_a_row_codebook_re_assessed_as_unlikely():
    table = {'ENSG00000000001': 'A', 'ENSG00000000002': 'B'}
    rows = [
        {'symbol': 'A', 'ensembl_id': 'ENSG00000000001', 'dbd': 'bHLH', 'evidence': 'Known motif'},
        {'symbol': 'B', 'ensembl_id': 'ENSG00000000002', 'dbd': 'bHLH', 'evidence': btc.UNLIKELY},
    ]
    assert _all(btc.build('human', rows, table))['genes'] == ['A']
