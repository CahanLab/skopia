"""Choosing which groups a heatmap shows, as the dot plot already allows.

``groups`` keeps only the cells whose ``obs_column`` label is listed, and a
category ordering lays the blocks out in the listed order. It is a filter on
the cells, so it holds under any ordering that names the column; without a
column there is nothing to filter by and it is an error.
"""
import anndata
import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix

from skopia.adaptor import DataAdaptor, FigureInputMissing
from skopia.heatmap import compute_heatmap_data

GENES = ['g1', 'g2', 'g3']


def _adata(string_column=False):
    rng = np.random.default_rng(0)
    n = 30
    X = rng.random((n, len(GENES))).astype(np.float32)
    labels = np.array(['a', 'b', 'c'])[np.arange(n) % 3]
    obs = pd.DataFrame({'grp': labels if string_column else pd.Categorical(labels, categories=['a', 'b', 'c'])},
                       index=[f'c{i}' for i in range(n)])
    return anndata.AnnData(X=csr_matrix(X), obs=obs, var=pd.DataFrame(index=GENES))


def _adaptor(**kw):
    return DataAdaptor('x.h5ad', adata=_adata(**kw))


@pytest.mark.parametrize('string_column', [False, True])
def test_only_the_chosen_groups_in_the_chosen_order(string_column):
    out = compute_heatmap_data(_adaptor(string_column=string_column), GENES, cell_ordering='category',
                               obs_column='grp', groups=['c', 'a'])
    assert [g['name'] for g in out['column_groups']] == ['c', 'a']
    assert [g['size'] for g in out['column_groups']] == [10, 10]
    assert out['n_cells'] == 20


def test_category_then_similarity_keeps_the_chosen_groups():
    out = compute_heatmap_data(_adaptor(), GENES, cell_ordering='category_then_similarity',
                               obs_column='grp', groups=['b'])
    assert [g['name'] for g in out['column_groups']] == ['b']
    assert out['n_cells'] == 10


def test_the_filter_holds_under_an_ordering_without_blocks():
    out = compute_heatmap_data(_adaptor(), GENES, cell_ordering='similarity', obs_column='grp', groups=['a', 'b'])
    assert out['n_cells'] == 20


def test_groups_without_a_column_is_an_error():
    with pytest.raises(ValueError, match='obs_column'):
        compute_heatmap_data(_adaptor(), GENES, cell_ordering='none', groups=['a'])


def test_an_unknown_label_is_an_error():
    with pytest.raises(ValueError, match="'z'"):
        compute_heatmap_data(_adaptor(), GENES, cell_ordering='category', obs_column='grp', groups=['a', 'z'])


def test_null_groups_shows_every_group():
    out = compute_heatmap_data(_adaptor(), GENES, cell_ordering='category', obs_column='grp', groups=None)
    assert [g['name'] for g in out['column_groups']] == ['a', 'b', 'c']


def test_groups_combine_with_a_cell_restriction():
    out = compute_heatmap_data(_adaptor(), GENES, cell_ordering='category', obs_column='grp',
                               groups=['a', 'b'], cell_indices=list(range(15)))
    assert sum(g['size'] for g in out['column_groups']) == out['n_cells'] == 10


def test_the_figure_records_groups_and_draws_them():
    a = _adaptor()
    sets = [{'name': 's', 'genes': GENES}]
    f = a.create_figure('expression_heatmap', inputs={'gene_sets': sets, 'obs_column': 'grp', 'groups': ['b', 'c']},
                        params={'cell_ordering': 'category'})
    assert f['inputs']['groups'] == ['b', 'c']
    data = a.figure_data(f['id'])
    assert [g['name'] for g in data['column_groups']] == ['b', 'c']
    with pytest.raises(ValueError, match='groups'):
        a.create_figure('expression_heatmap', inputs={'gene_sets': sets, 'obs_column': 'grp', 'groups': ['zz']})


def test_a_figure_whose_label_is_gone_says_so():
    a = _adaptor()
    f = a.create_figure('expression_heatmap', inputs={'gene_sets': [{'name': 's', 'genes': GENES}],
                                                      'obs_column': 'grp', 'groups': ['b']},
                        params={'cell_ordering': 'category'})
    a.adata.obs['grp'] = pd.Categorical(np.array(['a', 'c', 'c'])[np.arange(a.adata.n_obs) % 3])
    with pytest.raises(FigureInputMissing, match="'b'"):
        a.figure_data(f['id'])


def test_the_route_takes_groups():
    from fastapi.testclient import TestClient
    from skopia.api import routes
    from skopia.main import app
    routes.set_adaptor(_adaptor(), slot='primary')
    client = TestClient(app)
    resp = client.post('/api/heatmap/data', json={'genes': GENES, 'cell_ordering': 'category',
                                                  'obs_column': 'grp', 'groups': ['c']})
    assert resp.status_code == 200, resp.text
    assert [g['name'] for g in resp.json()['column_groups']] == ['c']
    resp = client.post('/api/heatmap/data', json={'genes': GENES, 'cell_ordering': 'category',
                                                  'obs_column': 'grp', 'groups': ['nope']})
    assert resp.status_code == 400
