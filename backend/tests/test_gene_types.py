"""Gene types: GENCODE class and named sets per gene, from a table or the file.

Runs against small fixture tables written here, never the shipped ones, so a
rebuild of the shipped tables cannot change what these pin.
"""
from __future__ import annotations

import gzip

import numpy as np
import pandas as pd
import pytest

from skopia import gene_types as gt

_MOUSE_ROWS = [
    ('ENSMUSG00000000001', 'Gnai3', 'protein_coding', 'chr3'),
    ('ENSMUSG00000000002', 'Rpl13', 'protein_coding', 'chr8'),
    ('ENSMUSG00000000003', 'mt-Co1', 'protein_coding', 'chrM'),
    ('ENSMUSG00000000004', 'Gm42418', 'lncRNA', 'chr17'),
    ('ENSMUSG00000000005', '1700001C02Rik', 'protein_coding', 'chr1'),
    ('ENSMUSG00000000006', 'Hba-a1', 'protein_coding', 'chr11'),
    ('ENSMUSG00000000007', 'Pbsn', 'processed_pseudogene', 'chrX'),
    ('ENSMUSG00000000008', 'Or5p60', 'protein_coding', 'chr7'),
    ('ENSMUSG00000000009', 'Tecg1', 'TEC', 'chr2'),
    ('ENSMUSG00000000010', 'Ighv1-1', 'IG_V_gene', 'chr12'),
    ('ENSMUSG00000000011', 'Oddg1', 'a_biotype_nobody_mapped', 'chr5'),
    ('ENSMUSG00000000012', 'Rps6ka1', 'protein_coding', 'chr4'),
    ('ENSMUSG00000000013', 'Spmap1', 'protein_coding', 'chr1'),
    # retired 10x 2020-A names: after every current symbol
    ('ENSMUSG00000000008', 'Olfr484', 'protein_coding', 'chr7'),
    ('ENSMUSG00000000013', '1700001P01Rik', 'protein_coding', 'chr1'),
]

_HUMAN_ROWS = [
    ('ENSG00000000001', 'GNAI3', 'protein_coding', 'chr1'),
    ('ENSG00000000002', 'RPL13', 'protein_coding', 'chr16'),
]


def _table(tmp_path, species, rows):
    path = tmp_path / f'gene_types_{species}.tsv.gz'
    with gzip.open(path, 'wt') as fh:
        fh.write('gene_id\tsymbol\tgene_type\tchromosome\n')
        for row in rows:
            fh.write('\t'.join(row) + '\n')
    return gt.load_table(species, path=path)


def _mouse(tmp_path):
    return _table(tmp_path, 'mouse', _MOUSE_ROWS)


def _by_name(ann, names):
    return dict(zip(names, ann.gene_class))


def test_classes_from_biotype(tmp_path):
    names = ['Gnai3', 'Tecg1', 'Ighv1-1', 'Oddg1', 'Pbsn', 'tdTomato']
    ann = gt.annotate_from_table(names, None, 'mouse', table=_mouse(tmp_path))
    assert _by_name(ann, names) == {
        'Gnai3': 'protein_coding', 'Tecg1': 'lncRNA', 'Ighv1-1': 'ig_tr',
        'Oddg1': 'other', 'Pbsn': 'pseudogene', 'tdTomato': 'unannotated',
    }
    assert ann.gene_type[names.index('Tecg1')] == 'TEC'
    assert ann.gene_type[names.index('tdTomato')] is None
    assert ann.source == {'kind': 'gencode', 'label': gt.RELEASES['mouse'], 'species': 'mouse'}


def test_match_order(tmp_path):
    # The id column wins over the name: this var name says Rpl13, its id Gnai3.
    names = ['Rpl13', 'ENSMUSG00000000004', 'Olfr484', 'tdTomato']
    ids = ['ENSMUSG00000000001.5', None, None, None]
    ann = gt.annotate_from_table(names, ids, 'mouse', table=_mouse(tmp_path))
    assert ann.gene_type == ['protein_coding', 'lncRNA', 'protein_coding', None]
    assert ann.gene_class == ['protein_coding', 'lncRNA', 'protein_coding', 'unannotated']
    assert ann.matched == {'ensembl_id': 2, 'symbol': 1, 'file': 0, 'unmatched': 1}


def test_upper_case_fallback_is_human_only(tmp_path):
    human = _table(tmp_path, 'human', _HUMAN_ROWS)
    ann = gt.annotate_from_table(['Gnai3'], None, 'human', table=human)
    assert ann.gene_class == ['protein_coding']
    assert ann.matched['symbol'] == 1
    ann = gt.annotate_from_table(['GNAI3'], None, 'mouse', table=_mouse(tmp_path))
    assert ann.gene_class == ['unannotated']


def test_sets_by_pattern_genes_chrom_biotype(tmp_path):
    names = ['mt-Co1', 'Rpl13', 'Rps6ka1', 'Gm42418', 'Hba-a1', 'Pbsn', 'Gnai3']
    ann = gt.annotate_from_table(names, None, 'mouse', table=_mouse(tmp_path))

    def members(name):
        return [n for n, hit in zip(names, ann.sets[name]) if hit]

    assert members('mt') == ['mt-Co1']
    assert members('ribo') == ['Rpl13']
    assert members('predicted') == ['Gm42418']
    assert members('rrna') == ['Gm42418']
    assert members('hb') == ['Hba-a1']
    assert members('x_linked') == ['Pbsn']
    assert set(ann.set_source.values()) == {'skopia'}


def test_chrom_alone_puts_a_gene_in_mt(tmp_path):
    rows = [('ENSMUSG00000000099', 'Cytb', 'protein_coding', 'chrM')]
    ann = gt.annotate_from_table(['Cytb'], None, 'mouse', table=_table(tmp_path, 'mouse', rows))
    assert ann.sets['mt'].tolist() == [True]


def test_pattern_sets_reach_unannotated_and_id_indexed_genes(tmp_path):
    table = _mouse(tmp_path)
    ann = gt.annotate_from_table(['Gm99999'], None, 'mouse', table=table)
    assert ann.gene_class == ['unannotated']
    assert ann.sets['predicted'].tolist() == [True]
    # Indexed by Ensembl id: the name is ENSMUSG..., the table symbol is Rpl13.
    ann = gt.annotate_from_table(['ENSMUSG00000000002'], None, 'mouse', table=table)
    assert ann.sets['ribo'].tolist() == [True]


def test_versioned_gene_ids_column(tmp_path):
    names = ['Gnai3', 'Rpl13', 'Pbsn']
    ids = ['ENSMUSG00000000001.5', 'ENSMUSG00000000002.12', 'ENSMUSG00000000007.1']
    ann = gt.annotate_from_table(names, ids, 'mouse', table=_mouse(tmp_path))
    assert ann.matched == {'ensembl_id': 3, 'symbol': 0, 'file': 0, 'unmatched': 0}


def test_file_annotation_wins():
    names = ['Rpl13', 'tdTomato', 'mt-Co1']
    var = pd.DataFrame(
        {
            'gene_class': pd.Categorical(['protein_coding', 'exogenous', None]),
            'biotype': ['protein_coding', 'exogenous', None],
            # The file's own ribo column, deliberately unlike what the pattern gives.
            'ribo': [False, True, False],
        },
        index=names,
    )
    ann = gt.annotate_from_var(var, names, 'mouse')
    assert ann.gene_class == ['protein_coding', 'exogenous', 'unannotated']
    assert ann.gene_type == ['protein_coding', 'exogenous', None]
    assert ann.sets['ribo'].tolist() == [False, True, False]
    assert ann.set_source['ribo'] == 'file'
    assert ann.sets['mt'].tolist() == [False, False, True]
    assert ann.set_source['mt'] == 'skopia'
    assert ann.source['kind'] == 'file'
    assert ann.source['label'] == "this file's annotation (gene_class and 1 set column)"
    assert ann.matched == {'ensembl_id': 0, 'symbol': 0, 'file': 2, 'unmatched': 1}


def test_file_annotation_needs_a_non_boolean_gene_class():
    names = ['A', 'B']
    assert gt.annotate_from_var(pd.DataFrame(index=names), names, 'mouse') is None
    var = pd.DataFrame({'gene_class': [True, False]}, index=names)
    assert gt.annotate_from_var(var, names, 'mouse') is None


def test_removal_mask(tmp_path):
    names = ['Gnai3', 'Gm42418', 'Pbsn', 'Rpl13', 'tdTomato']
    ann = gt.annotate_from_table(names, None, 'mouse', table=_mouse(tmp_path))
    mask = gt.removal_mask(ann, ['lncRNA', 'pseudogene'], ['ribo'])
    assert mask.dtype == bool
    assert [n for n, m in zip(names, mask) if m] == ['Gm42418', 'Pbsn', 'Rpl13']
    assert not gt.removal_mask(ann, [], []).any()


def test_removal_mask_rejects_unknown_names(tmp_path):
    ann = gt.annotate_from_table(['Gnai3'], None, 'mouse', table=_mouse(tmp_path))
    with pytest.raises(ValueError, match='protein_coding'):
        gt.removal_mask(ann, ['coding'], [])
    with pytest.raises(ValueError, match='ribo'):
        gt.removal_mask(ann, [], ['ribosomal'])


def test_load_sets_has_descriptions_and_the_class_map():
    sets, classes = gt.load_sets('mouse')
    assert '45S_ribo' in sets and 'predicted' in sets
    assert all(isinstance(d.get('description'), str) for d in sets.values())
    assert classes['TEC'] == 'lncRNA' and classes['IG_V_gene'] == 'ig_tr'
    with pytest.raises(ValueError, match='human, mouse'):
        gt.load_sets('zebrafish')


def test_sets_are_bool_arrays(tmp_path):
    ann = gt.annotate_from_table(['Gnai3', 'Rpl13'], None, 'mouse', table=_mouse(tmp_path))
    assert all(isinstance(v, np.ndarray) and v.dtype == bool for v in ann.sets.values())


def test_a_renamed_gene_is_judged_by_its_current_symbol(tmp_path):
    """A 10x 2020-A placeholder that M39 has named is no longer `predicted`:
    a gene's sets must not depend on which of its names the dataset used.
    The dataset's own name still counts for a gene the table does not know."""
    table = _mouse(tmp_path)
    ann = gt.annotate_from_table(['1700001P01Rik', '1700001C02Rik', 'Gm99999'], None, 'mouse', table=table)
    assert ann.gene_class == ['protein_coding', 'protein_coding', 'unannotated']
    assert ann.sets['predicted'].tolist() == [False, True, True]
    # the same through the id column
    ann = gt.annotate_from_table(['1700001P01Rik'], ['ENSMUSG00000000013.2'], 'mouse', table=table)
    assert ann.sets['predicted'].tolist() == [False]


def test_genes_lists_still_match_either_name(tmp_path):
    """Curated lists carry old and new symbols; a listed old name still counts."""
    rows = [('ENSMUSG00000000020', 'Cenpu', 'protein_coding', 'chr8'),
            ('ENSMUSG00000000020', 'Mlf1ip', 'protein_coding', 'chr8')]
    ann = gt.annotate_from_table(['Mlf1ip'], None, 'mouse', table=_table(tmp_path, 'mouse', rows))
    assert ann.sets['cell_cycle_s'].tolist() == [True]


def test_missing_written_as_text_is_unannotated():
    """`.astype(str)`, a common fix for an h5ad write error, turns a missing
    class into the text 'nan'; it is still a gene with no class."""
    names = ['A', 'B', 'C', 'D', 'E']
    var = pd.DataFrame({'gene_class': ['protein_coding', 'nan', 'None', 'NA', '']}, index=names)
    ann = gt.annotate_from_var(var, names, 'mouse')
    assert ann.gene_class == ['protein_coding'] + ['unannotated'] * 4


def test_a_nullable_boolean_set_column_with_missing_values():
    """Missing in a nullable-boolean set column means not in the set."""
    names = ['Rpl13', 'Gnai3', 'Actb']
    var = pd.DataFrame({'gene_class': ['protein_coding'] * 3,
                        'ribo': pd.array([True, None, False], dtype='boolean')}, index=names)
    ann = gt.annotate_from_var(var, names, 'mouse')
    assert ann.sets['ribo'].tolist() == [True, False, False]
    assert ann.set_source['ribo'] == 'file'
