"""Gene-set aggregate rows in the Expression heatmap score a set the way the
Display panel colours the embedding by it.

Before 2026-11-25 an aggregate row was a plain mean of the set's unscaled
values, so a high-magnitude gene drowned the others, while the embedding
coloured by the same set z-scored each gene first (MAD, the Display
default). The row now goes through the same pipeline as the embedding:
scoring method (mean pipeline or UCell), per-gene normalisation, the minmax
clip, aggregation across genes, with per-gene statistics taken over every
cell, as the embedding's are. The row is then rescaled to 0..1 like every
heatmap row.

Figures saved before the change carry none of the new params and keep the
plain mean they were drawn with.
"""
import json

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

GENES = ['big', 'small', 'other', 'down']
N = 40


def _adata():
    rng = np.random.default_rng(0)
    X = rng.poisson(1.0, size=(N, len(GENES))).astype(np.float32)
    X[:, 0] *= 100.0  # one gene two orders of magnitude above the rest
    grp = np.array(['a', 'b'])[np.arange(N) % 2]
    ad = anndata.AnnData(X=csr_matrix(X), obs=pd.DataFrame({'grp': pd.Categorical(grp)},
                                                           index=[f'c{i}' for i in range(N)]))
    ad.var_names = GENES
    return ad


def _adaptor():
    return DataAdaptor('x.h5ad', adata=_adata())


SET = {'name': 's', 'genes': ['big', 'small']}


def _minmax(v):
    v = np.asarray(v, dtype=np.float64)
    rng = v.max() - v.min()
    return (v - v.min()) / (rng if rng else 1.0)


def _row(out):
    assert out['row_labels'] == ['s']
    return np.asarray(out['matrix'][0])


def test_default_aggregate_is_the_display_default_pipeline():
    a = _adaptor()
    out = compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[SET], aggregate_gene_sets=True)
    want = a.get_multi_gene_expression(['big', 'small'], per_gene_norm='zscore_mad', per_gene_clip=1.0,
                                       aggregation='mean', clip_percentile=0)['values']
    np.testing.assert_allclose(_row(out), _minmax(want), atol=1e-4)


def test_no_per_gene_scaling_is_the_old_plain_mean():
    a = _adaptor()
    out = compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[SET], aggregate_gene_sets=True,
                               gene_set_per_gene_norm='none')
    X = a.adata.X.toarray()
    np.testing.assert_allclose(_row(out), _minmax(X[:, :2].mean(axis=1)), atol=1e-4)
    # and the big gene dominates it, which is the reason for the default
    assert np.corrcoef(_row(out), X[:, 0])[0, 1] > 0.99


@pytest.mark.parametrize('norm', ['zscore_mad', 'zscore_sd', 'minmax', 'rank'])
@pytest.mark.parametrize('agg', ['mean', 'median', 'max'])
def test_every_option_matches_the_embedding_score(norm, agg):
    a = _adaptor()
    out = compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[SET], aggregate_gene_sets=True,
                               gene_set_per_gene_norm=norm, gene_set_per_gene_clip=2.0, gene_set_aggregation=agg)
    want = a.get_multi_gene_expression(['big', 'small'], per_gene_norm=norm, per_gene_clip=2.0,
                                       aggregation=agg, clip_percentile=0)['values']
    np.testing.assert_allclose(_row(out), _minmax(want), atol=1e-4)


def test_per_gene_statistics_are_over_every_cell_not_the_plotted_ones():
    a = _adaptor()
    cells = list(range(0, N, 3))
    out = compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[SET], aggregate_gene_sets=True,
                               cell_indices=cells)
    full = np.asarray(a.get_multi_gene_expression(['big', 'small'], per_gene_norm='zscore_mad', per_gene_clip=1.0,
                                                  aggregation='mean', clip_percentile=0)['values'])
    np.testing.assert_allclose(_row(out), _minmax(full[cells]), atol=1e-4)


def test_rows_follow_the_cell_ordering():
    a = _adaptor()
    out = compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[SET], aggregate_gene_sets=True,
                               cell_ordering='category', obs_column='grp', groups=['b', 'a'])
    full = np.asarray(a.get_multi_gene_expression(['big', 'small'], per_gene_norm='zscore_mad', per_gene_clip=1.0,
                                                  aggregation='mean', clip_percentile=0)['values'])
    order = list(range(1, N, 2)) + list(range(0, N, 2))
    np.testing.assert_allclose(_row(out), _minmax(full[order]), atol=1e-4)


def test_ucell_uses_the_sets_down_genes():
    a = _adaptor()
    s = {'name': 's', 'genes': ['big', 'small'], 'genes_down': ['down']}
    out = compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[s], aggregate_gene_sets=True,
                               gene_set_scoring_method='ucell')
    want = a.ucell_score_values(['big', 'small'], ['down'])['values']
    np.testing.assert_allclose(_row(out), _minmax(want), atol=1e-4)
    up_only = compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[SET], aggregate_gene_sets=True,
                                   gene_set_scoring_method='ucell')
    np.testing.assert_allclose(_row(up_only), _minmax(a.ucell_score_values(['big', 'small'])['values']), atol=1e-4)


def test_a_masked_gene_leaves_the_aggregate():
    a = _adaptor()
    a._visible_gene_mask = np.array([False, True, True, True])
    out = compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[SET], aggregate_gene_sets=True,
                               gene_set_per_gene_norm='none')
    np.testing.assert_allclose(_row(out), _minmax(a.adata.X.toarray()[:, 1]), atol=1e-4)


def test_bad_options_are_refused():
    a = _adaptor()
    for kw in ({'gene_set_scoring_method': 'auc'}, {'gene_set_per_gene_norm': 'z'},
               {'gene_set_aggregation': 'mode'}, {'gene_set_per_gene_clip': -1}):
        with pytest.raises(ValueError):
            compute_heatmap_data(a, ['big', 'small'], gene_set_groups=[SET], aggregate_gene_sets=True, **kw)


def test_route_passes_the_options(monkeypatch):
    a = _adaptor()
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    client = TestClient(app)
    body = {'genes': ['big', 'small'], 'gene_set_groups': [SET], 'aggregate_gene_sets': True}
    res = client.post('/api/heatmap/data', json={**body, 'gene_set_per_gene_norm': 'none'})
    assert res.status_code == 200, res.text
    np.testing.assert_allclose(res.json()['matrix'][0], _minmax(a.adata.X.toarray()[:, :2].mean(axis=1)), atol=1e-4)
    res = client.post('/api/heatmap/data', json={
        'genes': ['big', 'small'], 'aggregate_gene_sets': True, 'gene_set_scoring_method': 'ucell',
        'gene_set_groups': [{'name': 's', 'genes': ['big', 'small'], 'genes_down': ['down']}]})
    assert res.status_code == 200, res.text
    np.testing.assert_allclose(res.json()['matrix'][0], _minmax(a.ucell_score_values(['big', 'small'], ['down'])['values']),
                               atol=1e-4)
    assert client.post('/api/heatmap/data', json={**body, 'gene_set_aggregation': 'mode'}).status_code == 400


def test_defaults_agree_between_display_route_module_and_figure_config():
    import inspect
    sig = inspect.signature(compute_heatmap_data).parameters
    req = routes.HeatmapRequest.model_fields
    # the shipped file, not a user override of it
    shipped = user_config._parse(user_config._repo_default_path())
    fig = shipped['figures']['expression_heatmap']
    display = shipped['display']
    for key in ('gene_set_scoring_method', 'gene_set_per_gene_norm', 'gene_set_per_gene_clip', 'gene_set_aggregation'):
        assert sig[key].default == req[key].default == fig[key] == display[key], key


def test_figure_records_the_options_and_an_old_figure_keeps_its_plain_mean():
    a = _adaptor()
    f = a.create_figure('expression_heatmap', inputs={'gene_sets': [SET]},
                        params={'aggregate_gene_sets': True, 'cell_ordering': 'none', 'n_bins': 0,
                                'gene_set_per_gene_norm': 'rank', 'gene_set_aggregation': 'max'})
    assert f['params']['gene_set_per_gene_norm'] == 'rank'
    want = a.get_multi_gene_expression(['big', 'small'], per_gene_norm='rank', aggregation='max', clip_percentile=0)['values']
    np.testing.assert_allclose(a.figure_data(f['id'])['matrix'][0], _minmax(want), atol=1e-4)

    # a record written before the options existed
    store = a._figure_store()
    rec = json.loads(store[f['id']])
    for k in ('gene_set_scoring_method', 'gene_set_per_gene_norm', 'gene_set_per_gene_clip', 'gene_set_aggregation'):
        rec['params'].pop(k)
    store[f['id']] = json.dumps(rec)
    a.adata.uns[a.FIGURES_UNS_KEY] = store
    np.testing.assert_allclose(a.figure_data(f['id'])['matrix'][0],
                               _minmax(a.adata.X.toarray()[:, :2].mean(axis=1)), atol=1e-4)

    with pytest.raises(ValueError):
        a.create_figure('expression_heatmap', inputs={'gene_sets': [SET]}, params={'gene_set_per_gene_norm': 'z'})


def test_figure_inputs_keep_a_sets_down_genes():
    a = _adaptor()
    s = {'name': 's', 'genes': ['big', 'small'], 'genes_down': ['down']}
    f = a.create_figure('expression_heatmap', inputs={'gene_sets': [s, SET]},
                        params={'aggregate_gene_sets': True, 'cell_ordering': 'none', 'n_bins': 0,
                                'gene_set_scoring_method': 'ucell'})
    assert f['inputs']['gene_sets'][0]['genes_down'] == ['down']
    assert 'genes_down' not in f['inputs']['gene_sets'][1]
    np.testing.assert_allclose(a.figure_data(f['id'])['matrix'][0],
                               _minmax(a.ucell_score_values(['big', 'small'], ['down'])['values']), atol=1e-4)
