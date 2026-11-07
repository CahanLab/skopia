"""Scanpy-style dot plots: fraction of cells expressing (dot size) and mean
expression (dot color) per gene per group, from the pure module through the
adaptor and the route.
"""

import anndata
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from xcell import dotplot as dp
from xcell.adaptor import DataAdaptor
from xcell.api import routes
from xcell.main import app


# ---------------------------------------------------------------------------
# Pure module: 6 cells × 3 genes, groups a (first three) and b (last three)
# ---------------------------------------------------------------------------

EXPR = np.array([
    # g0   g1   g2
    [2.0, 0.0, 1.0],
    [2.0, 0.0, 1.0],
    [2.0, 0.0, 1.0],
    [1.0, 3.0, 0.0],
    [0.0, 3.0, 0.0],
    [0.0, 0.0, 0.0],
], dtype=np.float64)
CATS = np.array(['a', 'a', 'a', 'b', 'b', 'b'])
GENES = ['g0', 'g1', 'g2']


def test_pct_and_mean_by_hand():
    out = dp.compute_dotplot(EXPR, CATS, GENES)
    assert out['genes'] == GENES and out['categories'] == ['a', 'b']
    assert out['n_cells'] == 6 and out['n_cells_per_category'] == [3, 3]
    assert out['pct'][0] == pytest.approx([1.0, 1 / 3])
    assert out['mean'][0] == pytest.approx([2.0, 1 / 3])
    assert out['pct'][1] == pytest.approx([0.0, 2 / 3])
    assert out['color_label'] == 'Mean expression'
    assert out['row_groups'] == [None, None, None]


def test_expression_cutoff_changes_the_fraction():
    out = dp.compute_dotplot(EXPR, CATS, GENES, expression_cutoff=1.5)
    assert out['pct'][0] == pytest.approx([1.0, 0.0])
    assert out['pct'][1] == pytest.approx([0.0, 2 / 3])


def test_mean_over_expressing_cells_only():
    out = dp.compute_dotplot(EXPR, CATS, GENES, color_by='mean_expressing')
    assert out['mean'][0] == pytest.approx([2.0, 1.0])
    # no expressing cell: the mean is 0, not NaN
    assert out['mean'][1][0] == 0.0
    assert out['color_label'] == 'Mean expression in expressing cells'


def test_standard_scale_per_gene():
    out = dp.compute_dotplot(EXPR, CATS, GENES, standard_scale='gene')
    for row in out['mean']:
        assert max(row) == pytest.approx(1.0) and min(row) == pytest.approx(0.0)
    assert out['color_label'] == 'Scaled mean expression'


def test_peak_group_ordering_within_gene_set_groups():
    groups = [{'name': 's1', 'genes': ['g1', 'g0']}, {'name': 's2', 'genes': ['g2']}]
    out = dp.compute_dotplot(EXPR[:, [1, 0, 2]], CATS, ['g1', 'g0', 'g2'], gene_set_groups=groups, gene_ordering='peak_group')
    # g0 peaks in a, g1 in b: a-first within s1; s2 stays after s1
    assert out['genes'] == ['g0', 'g1', 'g2']
    assert out['row_groups'] == ['s1', 's1', 's2']


def test_a_gene_in_two_groups_appears_twice():
    groups = [{'name': 's1', 'genes': ['g0']}, {'name': 's2', 'genes': ['g0', 'g2']}]
    out = dp.compute_dotplot(EXPR[:, [0, 0, 2]], CATS, ['g0', 'g0', 'g2'], gene_set_groups=groups)
    assert out['genes'] == ['g0', 'g0', 'g2'] and out['row_groups'] == ['s1', 's2', 's2']


def test_category_order_and_absent_categories():
    out = dp.compute_dotplot(EXPR, CATS, GENES, category_order=['b', 'a', 'zzz'])
    assert out['categories'] == ['b', 'a']
    assert out['pct'][0] == pytest.approx([1 / 3, 1.0])


def test_bad_arguments():
    with pytest.raises(ValueError):
        dp.compute_dotplot(EXPR, CATS, GENES, color_by='median')
    with pytest.raises(ValueError):
        dp.compute_dotplot(EXPR, CATS, GENES, standard_scale='obs')
    with pytest.raises(ValueError):
        dp.compute_dotplot(EXPR, CATS, GENES, gene_ordering='similarity')


# ---------------------------------------------------------------------------
# Adaptor path and route
# ---------------------------------------------------------------------------

N_CELLS, N_GENES = 90, 6
VAR = [f'g{i:02d}' for i in range(N_GENES)]


def _adata():
    rng = np.random.default_rng(0)
    X = rng.poisson(1.0, size=(N_CELLS, N_GENES)).astype(np.float32)
    grp = np.array(['a'] * 30 + ['b'] * 30 + ['c'] * 30)
    X[grp == 'a', 0] += 8.0
    X[grp == 'b', 1] += 8.0
    ad = anndata.AnnData(X=csr_matrix(X))
    ad.var_names = VAR
    ad.obs['grp'] = pd.Categorical(grp)
    ad.obs['depth'] = X.sum(axis=1)
    ad.uns['grp_colors'] = ['#111111', '#222222', '#333333']
    return ad


def _adaptor():
    return DataAdaptor('x.h5ad', adata=_adata())


def test_adaptor_dotplot_reads_raw_or_log1p():
    a = _adaptor()
    raw = a.dotplot_data(['g00', 'g01'], None, 'grp')
    assert raw['categories'] == ['a', 'b', 'c'] and raw['obs_column'] == 'grp'
    assert raw['category_colors'] == ['#111111', '#222222', '#333333']
    assert raw['mean'][0][0] > 8.0
    logged = a.dotplot_data(['g00', 'g01'], None, 'grp', transform='log1p')
    assert logged['mean'][0][0] < 4.0
    assert raw['n_genes_hidden'] == 0


def test_adaptor_dotplot_honours_cells_and_the_gene_mask():
    a = _adaptor()
    out = a.dotplot_data(['g00', 'nope'], None, 'grp', cell_indices=list(range(60)))
    assert out['categories'] == ['a', 'b'] and out['n_cells'] == 60
    assert out['genes'] == ['g00']
    a._visible_gene_mask = np.array([False] + [True] * (N_GENES - 1))
    masked = a.dotplot_data(['g00', 'g01'], None, 'grp')
    assert masked['genes'] == ['g01'] and masked['n_genes_hidden'] == 1


def test_adaptor_dotplot_refuses_a_non_categorical_column():
    a = _adaptor()
    with pytest.raises(ValueError):
        a.dotplot_data(['g00'], None, 'depth')
    with pytest.raises(ValueError):
        a.dotplot_data(['g00'], None, 'missing')


def test_route_with_gene_sets_and_with_markers(monkeypatch):
    a = _adaptor()
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    client = TestClient(app)
    res = client.post('/api/dotplot/data', json={
        'genes': ['g00', 'g01'], 'gene_set_groups': [{'name': 's', 'genes': ['g00', 'g01']}],
        'obs_column': 'grp', 'standard_scale': 'gene',
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body['row_groups'] == ['s', 's'] and max(body['mean'][0]) == pytest.approx(1.0)
    key = a.run_marker_genes(obs_column='grp', top_n=1)['key']
    res = client.post('/api/dotplot/data', json={'markers': {'key': key, 'top_n': 1}, 'obs_column': 'grp'})
    assert res.status_code == 200, res.text
    assert res.json()['genes'][:2] == ['g00', 'g01']
    res = client.post('/api/dotplot/data', json={'markers': {'key': key, 'top_n': 1, 'restrict_to': {'label': 'one', 'genes': ['g01']}},
                                                 'obs_column': 'grp'})
    assert res.status_code == 200, res.text
    assert res.json()['genes'] == ['g01'] and len(res.json()['row_groups']) == 1
    assert client.post('/api/dotplot/data', json={'genes': ['g00'], 'obs_column': 'depth'}).status_code == 400
    assert client.post('/api/dotplot/data', json={'markers': {'key': 'nope'}, 'obs_column': 'grp'}).status_code == 404


# ---------------------------------------------------------------------------
# Group choice and group ordering
# ---------------------------------------------------------------------------

# a and c share a profile (g0 on, g1 off); b is the odd one out
EXPR3 = np.array([
    [3.0, 0.0], [3.0, 0.0],   # a
    [0.0, 3.0], [0.0, 3.0],   # b
    [2.5, 0.2], [3.1, 0.0],   # c
])
CATS3 = np.array(['a', 'a', 'b', 'b', 'c', 'c'])


def test_group_ordering_as_given_is_the_default_and_keeps_category_order():
    out = dp.compute_dotplot(EXPR3, CATS3, ['g0', 'g1'])
    assert out['categories'] == ['a', 'b', 'c'] and out['group_ordering'] == 'as_given'
    out = dp.compute_dotplot(EXPR3, CATS3, ['g0', 'g1'], category_order=['c', 'a', 'b'], group_ordering='as_given')
    assert out['categories'] == ['c', 'a', 'b']


def test_cluster_group_ordering_puts_similar_groups_side_by_side():
    out = dp.compute_dotplot(EXPR3, CATS3, ['g0', 'g1'], group_ordering='cluster')
    cats = out['categories']
    assert sorted(cats) == ['a', 'b', 'c'] and cats.index('b') in (0, 2)
    assert out['group_ordering'] == 'cluster'
    # the matrices follow the new column order
    j = cats.index('b')
    assert out['mean'][1][j] == pytest.approx(3.0) and out['pct'][0][j] == 0.0


def test_cluster_ordering_with_fewer_than_three_groups_is_the_given_order():
    out = dp.compute_dotplot(EXPR, CATS, GENES, group_ordering='cluster', category_order=['b', 'a'])
    assert out['categories'] == ['b', 'a']
    with pytest.raises(ValueError):
        dp.compute_dotplot(EXPR, CATS, GENES, group_ordering='alphabetical')


def test_adaptor_groups_restrict_the_cells_and_fix_the_order():
    a = _adaptor()
    out = a.dotplot_data(['g00', 'g01'], None, 'grp', groups=['c', 'a'])
    assert out['categories'] == ['c', 'a'] and out['n_cells'] == 60
    assert out['n_cells_per_category'] == [30, 30]
    assert out['category_colors'] == ['#333333', '#111111']
    with pytest.raises(ValueError, match="'zzz'"):
        a.dotplot_data(['g00'], None, 'grp', groups=['a', 'zzz'])
    with pytest.raises(ValueError):
        a.dotplot_data(['g00'], None, 'grp', groups=[])


def test_adaptor_cluster_ordering_reaches_the_pure_module():
    a = _adaptor()
    out = a.dotplot_data(['g00', 'g01'], None, 'grp', group_ordering='cluster')
    assert sorted(out['categories']) == ['a', 'b', 'c'] and out['group_ordering'] == 'cluster'
    # a carries g00, b carries g01, c neither: c is equidistant from both and
    # the leaf ordering puts it between them.
    assert out['categories'].index('c') == 1


def test_route_takes_groups_and_group_ordering(monkeypatch):
    a = _adaptor()
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    client = TestClient(app)
    res = client.post('/api/dotplot/data', json={'genes': ['g00', 'g01'], 'obs_column': 'grp',
                                                 'groups': ['b', 'a'], 'group_ordering': 'as_given'})
    assert res.status_code == 200, res.text
    assert res.json()['categories'] == ['b', 'a'] and res.json()['n_cells'] == 60
    res = client.post('/api/dotplot/data', json={'genes': ['g00', 'g01'], 'obs_column': 'grp', 'group_ordering': 'cluster'})
    assert res.status_code == 200, res.text
    assert sorted(res.json()['categories']) == ['a', 'b', 'c']
    assert client.post('/api/dotplot/data', json={'genes': ['g00'], 'obs_column': 'grp', 'groups': ['nope']}).status_code == 400
    assert client.post('/api/dotplot/data', json={'genes': ['g00'], 'obs_column': 'grp', 'group_ordering': 'x'}).status_code == 400
