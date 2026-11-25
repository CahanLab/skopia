"""One heatmap column per cell group.

With ``group_columns`` the heatmap collapses each group of a category
ordering to one column: the mean over the group's cells of what the rows
hold, an aggregate row's per-cell set score (the embedding's), or a gene's
expression. Rows are then rescaled to 0..1 across the groups like any
heatmap row. Binning does not apply, and without cells grouped by a column
there are no groups to collapse, so the option is refused.
"""
import anndata
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from skopia import config as user_config
from skopia.adaptor import DataAdaptor
from skopia.api import routes
from skopia.heatmap import compute_heatmap_data
from skopia.main import app

GENES = ['g0', 'g1', 'g2']
LABELS = np.array(['a', 'b', 'c'])


def _adata():
    rng = np.random.default_rng(0)
    n = 60
    X = rng.poisson(1.0, size=(n, len(GENES))).astype(np.float32)
    X[:20, 0] += 6.0      # a: g0
    X[20:40, 1] += 6.0    # b: g1
    grp = np.repeat(LABELS, 20)
    ad = anndata.AnnData(X=csr_matrix(X), obs=pd.DataFrame({'grp': pd.Categorical(grp, categories=list(LABELS))},
                                                           index=[f'c{i}' for i in range(n)]))
    ad.var_names = GENES
    return ad


def _adaptor():
    return DataAdaptor('x.h5ad', adata=_adata())


def _minmax(v):
    v = np.asarray(v, dtype=np.float64)
    rng = v.max() - v.min()
    return (v - v.min()) / (rng if rng else 1.0)


SET = {'name': 's', 'genes': ['g0', 'g1']}
GROUPED = {'cell_ordering': 'category', 'obs_column': 'grp', 'group_columns': True}


def test_an_aggregate_row_is_the_mean_score_of_each_group():
    a = _adaptor()
    out = compute_heatmap_data(a, ['g0', 'g1'], gene_set_groups=[SET], aggregate_gene_sets=True, **GROUPED)
    score = np.asarray(a.get_multi_gene_expression(['g0', 'g1'], per_gene_norm='zscore_mad', per_gene_clip=1.0,
                                                   aggregation='mean', clip_percentile=0)['values'])
    want = [score[a.adata.obs['grp'] == g].mean() for g in LABELS]
    np.testing.assert_allclose(out['matrix'][0], _minmax(want), atol=1e-4)
    assert out['column_groups'] == [{'name': g, 'start': i, 'size': 1} for i, g in enumerate(LABELS)]
    assert out['n_bins'] == 3 and out['n_cells'] == 60 and out['group_columns'] is True


def test_gene_rows_are_group_means_too():
    a = _adaptor()
    out = compute_heatmap_data(a, GENES, **GROUPED)
    X = a.adata.X.toarray()
    for j, g in enumerate(GENES):
        want = [X[a.adata.obs['grp'] == lab, j].mean() for lab in LABELS]
        np.testing.assert_allclose(out['matrix'][out['row_labels'].index(g)], _minmax(want), atol=1e-4)


def test_the_chosen_groups_in_the_chosen_order_and_bins_ignored():
    a = _adaptor()
    out = compute_heatmap_data(a, ['g0', 'g1'], gene_set_groups=[SET], aggregate_gene_sets=True,
                               groups=['c', 'a'], n_bins=7, **GROUPED)
    assert [g['name'] for g in out['column_groups']] == ['c', 'a']
    assert len(out['matrix'][0]) == 2 and out['n_bins'] == 2 and out['n_cells'] == 40


def test_category_then_similarity_collapses_the_same_way():
    a = _adaptor()
    plain = compute_heatmap_data(a, GENES, **GROUPED)
    sim = compute_heatmap_data(a, GENES, **{**GROUPED, 'cell_ordering': 'category_then_similarity'})
    np.testing.assert_allclose(sim['matrix'], plain['matrix'], atol=1e-6)


def test_off_by_default_and_refused_without_groups():
    a = _adaptor()
    assert compute_heatmap_data(a, GENES, cell_ordering='category', obs_column='grp')['group_columns'] is False
    for ordering in ('none', 'similarity', 'line_position'):
        with pytest.raises(ValueError, match='group_columns'):
            compute_heatmap_data(a, GENES, cell_ordering=ordering, group_columns=True)


def test_route(monkeypatch):
    a = _adaptor()
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    client = TestClient(app)
    res = client.post('/api/heatmap/data', json={'genes': GENES, **GROUPED})
    assert res.status_code == 200, res.text
    assert len(res.json()['matrix'][0]) == 3
    assert client.post('/api/heatmap/data', json={'genes': GENES, 'group_columns': True}).status_code == 400


def test_figure_param():
    a = _adaptor()
    f = a.create_figure('expression_heatmap', inputs={'gene_sets': [SET], 'obs_column': 'grp'},
                        params={'aggregate_gene_sets': True, 'cell_ordering': 'category', 'group_columns': True})
    assert a.figure_data(f['id'])['group_columns'] is True
    assert len(a.figure_data(f['id'])['matrix'][0]) == 3
    with pytest.raises(ValueError, match='group_columns'):
        a.create_figure('expression_heatmap', inputs={'gene_sets': [SET]},
                        params={'cell_ordering': 'none', 'group_columns': True})
    shipped = user_config._parse(user_config._repo_default_path())
    assert shipped['figures']['expression_heatmap']['group_columns'] is False
