"""Merging .obs columns into one: the first non-empty value wins, in order.

The common case is the pair a combine left apart — `cell_type__A` and
`cell_type__B`, each empty for the other dataset's cells — and filling one
annotation's gaps from another. Every merge is one logged step the notebook
replays exactly.
"""
import anndata
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from xcell.adaptor import DataAdaptor, CELL_SUBSETS_UNS
from xcell.api import routes
from xcell.codegen import EXACT, translate
from xcell.main import app

N = 12


def _adata():
    rng = np.random.default_rng(0)
    ad = anndata.AnnData(X=csr_matrix(rng.random((N, 5)).astype(np.float32)))
    ad.var_names = [f'g{i}' for i in range(5)]
    ad.obs_names = [f'c{i}' for i in range(N)]
    # A combine's split pair: A holds the first half, B the second.
    half = N // 2
    ad.obs['ct__A'] = pd.Categorical(['T cell', 'B cell'] * 3 + [np.nan] * half)
    ad.obs['ct__B'] = pd.Categorical([np.nan] * half + ['B cell', 'Mono'] * 3)
    # An annotation with gaps and a second one that overlaps it.
    ad.obs['coarse'] = pd.Series(['Immune', '', 'unassigned', np.nan] * 3, index=ad.obs_names, dtype=object)
    ad.obs['fine'] = pd.Series(['T', 'B', 'NK', np.nan] * 3, index=ad.obs_names, dtype=object)
    ad.obs['score_a'] = np.where(np.arange(N) < half, rng.random(N), np.nan)
    ad.obs['score_b'] = np.where(np.arange(N) >= half, rng.random(N), np.nan)
    ad.obs['n_a'] = np.arange(N, dtype=np.int64)
    ad.obs['n_b'] = np.arange(N, dtype=np.int64) * 10
    ad.obs['flag'] = np.array([True, False] * (N // 2))
    ad.obs['int_cat'] = pd.Categorical([1, 2] * (N // 2))
    ad.obs['ct__A_colors_bait'] = 0
    ad.uns['ct__A_colors'] = ['#111111', '#222222']
    return ad


def _adaptor():
    return DataAdaptor('x.h5ad', adata=_adata())


def _install(monkeypatch, a):
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    return TestClient(app)


def test_merge_takes_the_first_non_empty_value_in_the_given_order():
    a = _adaptor()
    out = a.merge_obs_columns(['ct__A', 'ct__B'], 'cell_type')
    col = a.adata.obs['cell_type']
    assert isinstance(col.dtype, pd.CategoricalDtype)
    assert col.notna().all()
    assert list(col.iloc[:2]) == ['T cell', 'B cell']
    assert list(col.iloc[-2:]) == ['B cell', 'Mono']
    # Categories: the values that won, in order of first appearance.
    assert list(col.cat.categories) == ['T cell', 'B cell', 'Mono']
    assert out == {
        'new_name': 'cell_type', 'columns': ['ct__A', 'ct__B'], 'kind': 'categorical',
        'n_conflicts': 0, 'n_missing': 0, 'dropped': [],
    }
    # Sources stay, with their palette; the merged column gets none.
    assert 'ct__A' in a.adata.obs and 'ct__A_colors' in a.adata.uns
    assert 'cell_type_colors' not in a.adata.uns
    assert a.analysis_record.steps[-1].action == 'merge_obs_columns'


def test_empty_strings_and_unassigned_count_as_empty_for_labels():
    """`unassigned` is xcell's own sentinel outside a mask; a merge that stops
    at it never reaches the real label."""
    a = _adaptor()
    out = a.merge_obs_columns(['coarse', 'fine'], 'merged')
    col = a.adata.obs['merged']
    assert col.iloc[0] == 'Immune'       # coarse wins where it has a value
    assert col.iloc[1] == 'B'            # '' in coarse → fine
    assert col.iloc[2] == 'NK'           # 'unassigned' in coarse → fine
    assert pd.isna(col.iloc[3])          # empty in both
    assert out['n_conflicts'] == 3       # 'Immune' rows also carry 'T'
    assert out['n_missing'] == 3


def test_order_decides_which_value_wins():
    a = _adaptor()
    a.merge_obs_columns(['fine', 'coarse'], 'merged')
    assert a.adata.obs['merged'].iloc[0] == 'T'


def test_numeric_sources_merge_to_float_or_int():
    a = _adaptor()
    out = a.merge_obs_columns(['score_a', 'score_b'], 'score')
    assert out['kind'] == 'float' and a.adata.obs['score'].notna().all()
    out = a.merge_obs_columns(['n_a', 'n_b'], 'n')
    assert out['kind'] == 'integer'
    assert list(a.adata.obs['n']) == list(range(N))
    assert out['n_conflicts'] == N


def test_an_integer_categorical_merges_with_text_as_labels():
    a = _adaptor()
    out = a.merge_obs_columns(['int_cat', 'fine'], 'mixed')
    assert out['kind'] == 'categorical'
    assert list(a.adata.obs['mixed'].cat.categories) == ['1', '2']
    assert a.adata.obs['mixed'].notna().all()


def test_drop_sources_removes_them_and_their_palettes():
    a = _adaptor()
    out = a.merge_obs_columns(['ct__A', 'ct__B'], 'cell_type', keep_sources=False)
    assert out['dropped'] == ['ct__A', 'ct__B']
    assert 'ct__A' not in a.adata.obs and 'ct__B' not in a.adata.obs
    assert 'ct__A_colors' not in a.adata.uns
    assert 'cell_type' in a.adata.obs


@pytest.mark.parametrize('columns, new_name, match', [
    (['ct__A'], 'x', 'at least two'),
    (['ct__A', 'ct__A'], 'x', 'at least two'),
    (['ct__A', 'ct__B'], 'fine', 'already exists'),
    (['ct__A', 'ct__B'], '', 'empty'),
    (['ct__A', 'score_a'], 'x', 'categorical.*float|different kinds'),
    (['flag', 'ct__A'], 'x', 'boolean'),
    (['ct__A', 'ct__B'], 'subset_x', 'subset'),
])
def test_refusals(columns, new_name, match):
    a = _adaptor()
    with pytest.raises(ValueError, match=match):
        a.merge_obs_columns(columns, new_name)
    assert 'x' not in a.adata.obs


def test_a_missing_column_is_a_key_error():
    a = _adaptor()
    with pytest.raises(KeyError, match='nope'):
        a.merge_obs_columns(['ct__A', 'nope'], 'x')


def test_a_saved_subsets_column_is_refused_as_a_source():
    a = _adaptor()
    a.adata.obs['subset_s'] = np.array([True] * 6 + [False] * 6)
    a.adata.uns[CELL_SUBSETS_UNS] = {'s': {'obs_key': 'subset_s', 'n_cells': 6}}
    with pytest.raises(ValueError, match="saved subset 's'"):
        a.merge_obs_columns(['subset_s', 'flag'], 'x')


@pytest.mark.parametrize('columns, keep', [
    (['ct__A', 'ct__B'], True),
    (['coarse', 'fine'], False),
    (['score_a', 'score_b'], True),
    (['n_a', 'n_b'], True),
    (['int_cat', 'fine'], True),
])
def test_the_notebook_replays_the_merge(columns, keep):
    a = _adaptor()
    a.merge_obs_columns(columns, 'merged', keep_sources=keep)
    t = translate(a.analysis_record.steps[-1])
    assert t.fidelity == EXACT
    ns = {'adata': _adata(), 'pd': pd, 'np': np}
    exec('\n'.join(t.code), ns)
    got, want = ns['adata'].obs['merged'], a.adata.obs['merged']
    pd.testing.assert_series_equal(got, want, check_names=False)
    assert str(got.dtype) == str(want.dtype)
    for c in columns:
        assert (c in ns['adata'].obs) == keep


def test_routes_merge_and_map_errors(monkeypatch):
    a = _adaptor()
    client = _install(monkeypatch, a)
    r = client.post('/api/obs/merge_columns',
                    json={'columns': ['ct__A', 'ct__B'], 'new_name': 'cell_type'})
    assert r.status_code == 200, r.text
    assert r.json()['n_conflicts'] == 0 and 'cell_type' in a.adata.obs
    r = client.post('/api/obs/merge_columns',
                    json={'columns': ['ct__A', 'ct__B'], 'new_name': 'cell_type'})
    assert r.status_code == 400 and 'already exists' in r.json()['detail']
    r = client.post('/api/obs/merge_columns',
                    json={'columns': ['ct__A', 'nope'], 'new_name': 'y'})
    assert r.status_code == 404
    r = client.post('/api/obs/merge_columns',
                    json={'columns': ['score_a', 'score_b'], 'new_name': 'score', 'keep_sources': False})
    assert r.status_code == 200 and r.json()['dropped'] == ['score_a', 'score_b']
