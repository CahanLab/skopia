"""The order of a marker run's row blocks in an expression plot.

By default the blocks follow the cell groups: when the run was made on the
plot's own grouping column and the plot names its groups (an order the user
dragged, or a pick), each group's markers sit in that order, so the heatmap
and the dot plot keep their diagonal. A block whose group is not named
follows, in the run's own order. ``group_order`` on the marker source is an
explicit override and wins; a name it gives that the run lacks is ignored,
since a run re-made under the same key may have other groups.
"""
import anndata
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from skopia import marker_genes as mg
from skopia.adaptor import DataAdaptor
from skopia.api import routes
from skopia.main import app

VAR = [f'g{i}' for i in range(6)]
N_PER = 20


def _adata():
    rng = np.random.default_rng(0)
    grp = np.repeat(['a', 'b', 'c'], N_PER)
    X = rng.poisson(1.0, size=(len(grp), len(VAR))).astype(np.float32)
    for j, g in enumerate('abc'):
        X[grp == g, j] += 10.0
    ad = anndata.AnnData(X=csr_matrix(X))
    ad.var_names = VAR
    ad.obs['grp'] = pd.Categorical(grp, categories=['a', 'b', 'c'])
    ad.obs['other'] = pd.Categorical(np.tile(['x', 'y'], len(grp) // 2))
    return ad


def _setup(monkeypatch):
    a = DataAdaptor('x.h5ad', adata=_adata())
    key = a.run_marker_genes(obs_column='grp', top_n=1)['key']
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    return a, key, TestClient(app)


def _blocks(body):
    return list(dict.fromkeys(g for g in body['row_groups'] if g is not None))


def test_pure_block_order():
    blocks = [{'name': n, 'genes': [n]} for n in 'abc']
    assert [b['name'] for b in mg.order_blocks(blocks, ['c', 'a', 'b'])] == ['c', 'a', 'b']
    assert [b['name'] for b in mg.order_blocks(blocks, ['c'])] == ['c', 'a', 'b']
    assert [b['name'] for b in mg.order_blocks(blocks, ['b', 'zz'])] == ['b', 'a', 'c']
    assert [b['name'] for b in mg.order_blocks(blocks, None)] == ['a', 'b', 'c']


def test_heatmap_blocks_follow_the_cell_groups(monkeypatch):
    a, key, client = _setup(monkeypatch)
    base = {'markers': {'key': key, 'top_n': 1}, 'cell_ordering': 'category', 'obs_column': 'grp'}
    res = client.post('/api/heatmap/data', json=base)
    assert res.status_code == 200, res.text
    assert _blocks(res.json()) == ['a', 'b', 'c']
    res = client.post('/api/heatmap/data', json={**base, 'groups': ['c', 'a', 'b']})
    assert _blocks(res.json()) == ['c', 'a', 'b']
    assert [g['name'] for g in res.json()['column_groups']] == ['c', 'a', 'b']
    # a pick of fewer groups: the named ones first, the rest after in run order
    res = client.post('/api/heatmap/data', json={**base, 'groups': ['c', 'b']})
    assert _blocks(res.json()) == ['c', 'b', 'a']


def test_an_override_wins_over_following(monkeypatch):
    a, key, client = _setup(monkeypatch)
    res = client.post('/api/heatmap/data', json={
        'markers': {'key': key, 'top_n': 1, 'group_order': ['b', 'c', 'a']},
        'cell_ordering': 'category', 'obs_column': 'grp', 'groups': ['c', 'a', 'b']})
    assert res.status_code == 200, res.text
    assert _blocks(res.json()) == ['b', 'c', 'a']


def test_another_column_does_not_reorder_the_blocks(monkeypatch):
    a, key, client = _setup(monkeypatch)
    res = client.post('/api/heatmap/data', json={
        'markers': {'key': key, 'top_n': 1}, 'cell_ordering': 'category', 'obs_column': 'other', 'groups': ['y', 'x']})
    assert res.status_code == 200, res.text
    assert _blocks(res.json()) == ['a', 'b', 'c']


def test_gene_sets_stay_after_the_marker_blocks(monkeypatch):
    a, key, client = _setup(monkeypatch)
    res = client.post('/api/heatmap/data', json={
        'markers': {'key': key, 'top_n': 1}, 'gene_set_groups': [{'name': 'mine', 'genes': ['g5']}],
        'cell_ordering': 'category', 'obs_column': 'grp', 'groups': ['b', 'c', 'a']})
    assert _blocks(res.json()) == ['b', 'c', 'a', 'mine']


def test_dotplot_blocks_follow_and_take_an_override(monkeypatch):
    a, key, client = _setup(monkeypatch)
    base = {'markers': {'key': key, 'top_n': 1}, 'obs_column': 'grp', 'groups': ['b', 'a', 'c']}
    res = client.post('/api/dotplot/data', json=base)
    assert res.status_code == 200, res.text
    assert res.json()['genes'] == ['g1', 'g0', 'g2']
    res = client.post('/api/dotplot/data', json={**base, 'markers': {**base['markers'], 'group_order': ['c', 'b', 'a']}})
    assert res.json()['genes'] == ['g2', 'g1', 'g0']


def test_run_summaries_list_their_groups(monkeypatch):
    a, key, client = _setup(monkeypatch)
    [summary] = a.list_marker_runs()
    assert summary['groups'] == ['a', 'b', 'c']


def test_figures_follow_their_groups_and_keep_an_override(monkeypatch):
    a, key, client = _setup(monkeypatch)
    f = a.create_figure('expression_heatmap', inputs={'marker_key': key, 'obs_column': 'grp', 'groups': ['c', 'b', 'a']},
                        params={'marker_top_n': 1, 'cell_ordering': 'category'})
    assert _blocks(a.figure_data(f['id'])) == ['c', 'b', 'a']
    g = a.create_figure('expression_dotplot', inputs={'marker_key': key, 'obs_column': 'grp', 'groups': ['c', 'b', 'a'],
                                                      'marker_group_order': ['a', 'c', 'b']},
                        params={'marker_top_n': 1})
    assert g['inputs']['marker_group_order'] == ['a', 'c', 'b']
    assert a.figure_data(g['id'])['genes'] == ['g0', 'g2', 'g1']
    for bad in ('a', [1], []):
        with pytest.raises(ValueError, match='marker_group_order'):
            a.create_figure('expression_dotplot', inputs={'marker_key': key, 'obs_column': 'grp', 'marker_group_order': bad})
    with pytest.raises(ValueError, match='marker_group_order'):
        a.create_figure('expression_heatmap', inputs={'gene_sets': [{'name': 's', 'genes': ['g0']}],
                                                      'marker_group_order': ['a']})
