"""Heatmap gene ordering by similarity.

``gene_ordering='similarity'`` clusters the per-row-normalised profiles
(average linkage) and lays the rows out in dendrogram leaf order, so genes
with the same shape sit together; inside gene-set groups when the rows are
grouped, like the peak-position ordering.
"""
import anndata
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

from xcell.adaptor import DataAdaptor
from xcell.heatmap import compute_heatmap_data


def _adata():
    """Two profile shapes interleaved by name: early (a, c, e) and late (b, d, f)."""
    rng = np.random.default_rng(0)
    n = 60
    t = np.linspace(0, 1, n)
    early = np.exp(-((t - 0.2) ** 2) / 0.02)
    late = np.exp(-((t - 0.8) ** 2) / 0.02)
    cols = {}
    for name in ('a', 'c', 'e'):
        cols[name] = early * rng.uniform(5, 10) + rng.normal(0, 0.05, n)
    for name in ('b', 'd', 'f'):
        cols[name] = late * rng.uniform(5, 10) + rng.normal(0, 0.05, n)
    names = ['a', 'b', 'c', 'd', 'e', 'f']
    X = np.column_stack([np.clip(cols[g], 0, None) for g in names]).astype(np.float32)
    obs = pd.DataFrame({'order': np.arange(n)}, index=[f'c{i}' for i in range(n)])
    return anndata.AnnData(X=csr_matrix(X), obs=obs, var=pd.DataFrame(index=names))


def _run(**kw):
    a = DataAdaptor('dummy.h5ad', adata=_adata())
    return compute_heatmap_data(a, genes=['a', 'b', 'c', 'd', 'e', 'f'], **kw)


def _groups_contiguous(labels, members):
    pos = [labels.index(m) for m in members]
    return max(pos) - min(pos) == len(members) - 1


def test_similarity_groups_genes_with_the_same_shape():
    out = _run(gene_ordering='similarity')
    labels = out['row_labels']
    assert sorted(labels) == ['a', 'b', 'c', 'd', 'e', 'f']
    assert _groups_contiguous(labels, ['a', 'c', 'e'])
    assert _groups_contiguous(labels, ['b', 'd', 'f'])
    assert labels != ['a', 'b', 'c', 'd', 'e', 'f']  # the input order was the interleaved one


def test_similarity_reorders_the_matrix_rows_with_the_labels():
    out = _run(gene_ordering='similarity', n_bins=10)
    mat = np.array(out['matrix'])
    for label, row in zip(out['row_labels'], mat):
        peak = int(np.argmax(row))
        assert (peak < 5) == (label in ('a', 'c', 'e')), (label, peak)


def test_similarity_stays_within_gene_set_groups():
    groups = [{'name': 'first', 'genes': ['a', 'b', 'c']}, {'name': 'second', 'genes': ['d', 'e', 'f']}]
    out = _run(gene_ordering='similarity', gene_set_groups=groups)
    labels, row_groups = out['row_labels'], out['row_groups']
    assert row_groups == ['first'] * 3 + ['second'] * 3
    assert set(labels[:3]) == {'a', 'b', 'c'} and set(labels[3:]) == {'d', 'e', 'f'}
    # within 'first', a and c (same shape) are adjacent; within 'second', d and f
    assert abs(labels.index('a') - labels.index('c')) == 1
    assert abs(labels.index('d') - labels.index('f')) == 1


def test_similarity_orders_aggregated_set_rows():
    groups = [{'name': 'E1', 'genes': ['a']}, {'name': 'L1', 'genes': ['b']},
              {'name': 'E2', 'genes': ['c']}, {'name': 'L2', 'genes': ['d']}]
    out = _run(gene_ordering='similarity', gene_set_groups=groups, aggregate_gene_sets=True)
    labels = out['row_labels']
    assert sorted(labels) == ['E1', 'E2', 'L1', 'L2']
    assert _groups_contiguous(labels, ['E1', 'E2'])


def test_similarity_with_one_or_two_rows_is_a_noop():
    a = DataAdaptor('dummy.h5ad', adata=_adata())
    assert compute_heatmap_data(a, genes=['b'], gene_ordering='similarity')['row_labels'] == ['b']
    assert compute_heatmap_data(a, genes=['b', 'a'], gene_ordering='similarity')['row_labels'] == ['b', 'a']


def test_unknown_gene_ordering_is_refused():
    import pytest
    with pytest.raises(ValueError, match='gene_ordering'):
        _run(gene_ordering='alphabetical')
