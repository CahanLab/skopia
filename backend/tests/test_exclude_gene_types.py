"""Exclude Genes by type: one mask for the preview, the removal and the mark.

The adaptor builds the exclusion from names, patterns and gene types in one
place, so the count the modal shows is the count Run removes and the column
Mark writes. Gene types come from a fixture table (monkeypatched over the
shipped one) or from the file's own ``gene_class`` annotation.
"""
from __future__ import annotations

import gzip
import json

import anndata as ad
import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix

from skopia import gene_types as gt
from skopia.adaptor import DataAdaptor

_ROWS = [
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
    ('ENSMUSG00000000008', 'Olfr484', 'protein_coding', 'chr7'),
]

GENES = ['Gnai3', 'Rpl13', 'mt-Co1', 'Gm42418', '1700001C02Rik', 'Hba-a1', 'Pbsn',
         'Or5p60', 'Tecg1', 'Ighv1-1', 'Oddg1', 'Rps6ka1', 'tdTomato']

# What the frontend's Protein-coding only preset sends for this dataset.
PRESET = {'classes': ['lncRNA', 'pseudogene', 'small_rna', 'ig_tr', 'other'],
          'sets': ['mt', 'ribo', 'predicted'], 'species': 'mouse'}
PRESET_REMOVES = {'mt-Co1', 'Rpl13', 'Gm42418', '1700001C02Rik', 'Pbsn', 'Tecg1', 'Ighv1-1', 'Oddg1'}


@pytest.fixture(autouse=True)
def _fixture_table(tmp_path, monkeypatch):
    path = tmp_path / 'gene_types_mouse.tsv.gz'
    with gzip.open(path, 'wt') as fh:
        fh.write('gene_id\tsymbol\tgene_type\tchromosome\n')
        for row in _ROWS:
            fh.write('\t'.join(row) + '\n')
    table = gt._read_table(path)
    monkeypatch.setattr(gt, 'load_table', lambda species, path=None: table)


def _adata(genes=GENES, var=None):
    rng = np.random.default_rng(0)
    X = csr_matrix(rng.poisson(2.0, size=(20, len(genes))).astype(np.float32))
    a = ad.AnnData(X=X, var=var if var is not None else pd.DataFrame(index=genes))
    a.var_names = list(genes)
    return a


def _adaptor(**kw):
    return DataAdaptor('x.h5ad', adata=_adata(**kw))


def _cryten_var():
    """A var shaped like the SJD pipeline's: its own classes and set columns."""
    return pd.DataFrame(
        {
            'gene_class': pd.Categorical(
                ['protein_coding', 'protein_coding', 'protein_coding', 'lncRNA', 'protein_coding',
                 'protein_coding', 'pseudogene', 'protein_coding', 'lncRNA', 'ig_tr', 'other',
                 'protein_coding', 'exogenous']),
            'biotype': ['protein_coding'] * 12 + ['exogenous'],
            'chrom': ['chr3', 'chr8', 'chrM', 'chr17', 'chr1', 'chr11', 'chrX', 'chr7', 'chr2',
                      'chr12', 'chr5', 'chr4', 'tdTomato'],
            'ribo': [False, True] + [False] * 11,
            'mt': [False, False, True] + [False] * 10,
        },
        index=GENES,
    )


def test_summary_total_equals_run():
    a = _adaptor()
    summary = a.gene_type_summary(patterns=['^Rps'], types=PRESET)
    run = _adaptor().run_exclude_genes(patterns=['^Rps'], types=PRESET)
    assert summary['selection']['n_removed'] == run['n_genes_removed'] == len(PRESET_REMOVES) + 1
    assert summary['selection']['n_kept'] == len(GENES) - run['n_genes_removed']
    assert summary['selection']['n_added_by_names_patterns'] == 1
    assert summary['selection']['added_examples'] == ['Rps6ka1']


def test_summary_counts_classes_and_sets():
    s = _adaptor().gene_type_summary()
    assert s['species'] == 'mouse'
    assert s['source'] == {'kind': 'gencode', 'label': 'GENCODE M23 + M39', 'species': 'mouse'}
    assert s['n_genes'] == len(GENES)
    assert s['matched'] == {'ensembl_id': 0, 'symbol': 12, 'file': 0, 'unmatched': 1}
    classes = {c['name']: c for c in s['classes']}
    assert [c['name'] for c in s['classes']] == list(gt.CLASS_ORDER)
    assert classes['protein_coding']['n'] == 7
    assert classes['unannotated'] == {'name': 'unannotated', 'n': 1, 'examples': ['tdTomato']}
    sets = {x['name']: x for x in s['sets']}
    assert sets['ribo']['n'] == 1 and sets['ribo']['examples'] == ['Rpl13']
    assert sets['ribo']['computed_by'] == 'skopia'
    assert 'ribosomal' in sets['ribo']['description'].lower()
    assert s['selection'] is None


def test_run_by_types_only():
    a = _adaptor()
    r = a.run_exclude_genes(types={'classes': ['lncRNA'], 'sets': ['mt'], 'species': 'mouse'})
    assert r['n_genes_removed'] == 3
    assert r['n_removed_by_types'] == 3
    assert r['type_source']['kind'] == 'gencode'
    assert set(GENES) - set(a.adata.var_names) == {'Gm42418', 'Tecg1', 'mt-Co1'}
    params = a._action_history[-1]['params']
    assert params['types'] == {'classes': ['lncRNA'], 'sets': ['mt'], 'species': 'mouse'}
    assert params['type_removed_genes'] == ['mt-Co1', 'Gm42418', 'Tecg1']


def test_run_by_types_names_and_patterns():
    a = _adaptor()
    r = a.run_exclude_genes(gene_names=['Gnai3'], patterns=['^Hb'],
                            types={'classes': ['pseudogene'], 'sets': [], 'species': 'mouse'})
    assert r['n_genes_removed'] == 3
    assert set(GENES) - set(a.adata.var_names) == {'Gnai3', 'Hba-a1', 'Pbsn'}
    assert a._action_history[-1]['params']['type_removed_genes'] == ['Pbsn']


def test_run_without_types_is_unchanged():
    a = _adaptor()
    r = a.run_exclude_genes(patterns=['^Rp'])
    assert set(GENES) - set(a.adata.var_names) == {'Rpl13', 'Rps6ka1'}
    assert r['n_removed_by_types'] == 0 and r['type_source'] is None
    assert a._action_history[-1]['params']['type_removed_genes'] == []


def test_unannotated_is_never_removed_unless_ticked():
    a = _adaptor()
    a.run_exclude_genes(types=PRESET)
    assert 'tdTomato' in a.adata.var_names
    b = _adaptor()
    b.run_exclude_genes(types={'classes': ['unannotated'], 'sets': [], 'species': 'mouse'})
    assert 'tdTomato' not in b.adata.var_names


def test_invalid_regex_in_summary():
    with pytest.raises(ValueError, match=r"Invalid regex pattern '\(\['"):
        _adaptor().gene_type_summary(patterns=['(['], types=PRESET)


def test_unknown_set_is_a_value_error():
    with pytest.raises(ValueError, match='ribosomal'):
        _adaptor().run_exclude_genes(types={'classes': [], 'sets': ['ribosomal'], 'species': 'mouse'})


def test_mark_matches_run_and_writes_type_columns():
    a = _adaptor()
    r = a.annotate_gene_types(PRESET, 'analysis_genes', patterns=['^Rps'])
    removed = PRESET_REMOVES | {'Rps6ka1'}
    kept = a.adata.var['analysis_genes']
    assert kept.dtype == bool
    assert {g for g in GENES if not kept[g]} == removed
    assert r == {'column': 'analysis_genes', 'n_kept': len(GENES) - len(removed),
                 'n_marked_out': len(removed), 'wrote_type_columns': ['gene_type', 'gene_class']}
    assert a.adata.var['gene_class']['Tecg1'] == 'lncRNA'
    assert a.adata.var['gene_type']['Tecg1'] == 'TEC'
    assert isinstance(a.adata.var['gene_class'].dtype, pd.CategoricalDtype)
    assert list(a.adata.var_names) == GENES
    assert a._action_history[-1]['action'] == 'annotate_gene_types'


def test_mark_does_not_make_the_table_the_files_own_annotation():
    a = _adaptor()
    a.annotate_gene_types(PRESET, 'analysis_genes')
    s = a.gene_type_summary()
    assert s['source']['kind'] == 'gencode'
    assert {x['name']: x['n'] for x in s['sets']}['x_linked'] == 1


def test_mark_keeps_the_files_own_columns():
    var = _cryten_var()
    a = _adaptor(var=var.copy())
    r = a.annotate_gene_types(PRESET, 'analysis_genes')
    assert r['wrote_type_columns'] == []
    assert 'gene_type' not in a.adata.var.columns
    pd.testing.assert_series_equal(a.adata.var['gene_class'], var['gene_class'], check_names=False)


def test_file_annotation_drives_the_summary():
    s = _adaptor(var=_cryten_var()).gene_type_summary()
    assert s['source']['kind'] == 'file'
    names = [c['name'] for c in s['classes']]
    assert names[:len(gt.CLASS_ORDER)] == list(gt.CLASS_ORDER) and names[-1] == 'exogenous'
    sets = {x['name']: x for x in s['sets']}
    assert sets['ribo']['computed_by'] == 'file' and sets['predicted']['computed_by'] == 'skopia'


def test_mark_refuses_existing_column():
    a = _adaptor(var=_cryten_var())
    before = a.adata.var.copy()
    with pytest.raises(ValueError, match="'ribo'"):
        a.annotate_gene_types(PRESET, 'ribo')
    pd.testing.assert_frame_equal(a.adata.var, before)
    a.annotate_gene_types(PRESET, 'ribo', overwrite=True)
    assert set(a.adata.var.columns) == set(before.columns)
    assert not a.adata.var['ribo'].equals(before['ribo'])
    pd.testing.assert_series_equal(a.adata.var['gene_class'], before['gene_class'])
    for name in ('highly_variable', 'highly_variable__sub', 'gene_class', 'gene_type'):
        with pytest.raises(ValueError, match=name):
            a.annotate_gene_types(PRESET, name, overwrite=True)


def test_mark_refuses_a_non_boolean_column_even_with_overwrite():
    a = _adaptor(var=_cryten_var())
    with pytest.raises(ValueError, match="'chrom'"):
        a.annotate_gene_types(PRESET, 'chrom', overwrite=True)


def test_mark_needs_a_selection():
    with pytest.raises(ValueError, match='gene type'):
        _adaptor().annotate_gene_types({'classes': [], 'sets': [], 'species': None}, 'analysis_genes')


def test_no_species():
    a = _adaptor(genes=['GRCh38_A', 'mm10___B'])
    s = a.gene_type_summary()
    assert s['species'] is None
    assert s['available_species'] == ['human', 'mouse']
    assert s['classes'] == [] and s['sets'] == []
    with pytest.raises(ValueError, match='species'):
        a.run_exclude_genes(types={'classes': ['lncRNA'], 'sets': [], 'species': None})
    assert list(a.adata.var_names) == ['GRCh38_A', 'mm10___B']


def test_summary_is_json_serializable():
    s = _adaptor().gene_type_summary(gene_names=['Gnai3'], patterns=['^Rps'], types=PRESET)
    json.dumps(s, allow_nan=False)
    json.dumps(_adaptor(var=_cryten_var()).gene_type_summary(types=PRESET), allow_nan=False)
