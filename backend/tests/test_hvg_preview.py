"""The Highly Variable Genes preview: mean vs dispersion per gene, with the
genes the current settings would select flagged.

The preview is only worth having if it shows what the run will do, so the
contract is that its flags equal the column a real run writes, under the same
parameters and on the same cells, and that asking for one changes nothing.
"""
import json

import anndata
import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from skopia.adaptor import DataAdaptor
from skopia.api import routes
from skopia.main import app


def _adata(n_cells=200, n_genes=120):
    rng = np.random.default_rng(0)
    rates = rng.gamma(0.6, 2.0, size=n_genes)
    counts = rng.poisson(rates, size=(n_cells, n_genes)).astype(np.float32)
    counts[:, :5] = 0  # unexpressed genes have no dispersion
    ad = anndata.AnnData(X=csr_matrix(counts))
    ad.layers['counts'] = ad.X.copy()
    ad.var_names = [f'g{i}' for i in range(n_genes)]
    ad.obs_names = [f'c{i}' for i in range(n_cells)]
    # log-normalised .X, as the seurat / cell_ranger flavors expect
    X = counts / np.maximum(counts.sum(1, keepdims=True), 1) * 1e4
    ad.X = csr_matrix(np.log1p(X).astype(np.float32))
    return ad


def _adaptor(ad=None):
    return DataAdaptor('x.h5ad', adata=ad if ad is not None else _adata())


PARAMS = [
    dict(flavor='seurat', n_top_genes=None, min_mean=0.0125, max_mean=3.0, min_disp=0.5),
    dict(flavor='cell_ranger', n_top_genes=30, min_mean=0.0125, max_mean=3.0, min_disp=0.5),
    dict(flavor='seurat', n_top_genes=40, min_mean=0.0125, max_mean=3.0, min_disp=0.5),
]


@pytest.mark.parametrize('params', PARAMS)
def test_the_flags_are_what_a_run_writes(params):
    ad = _adata()
    preview = _adaptor(ad.copy()).preview_highly_variable_genes(**params)
    ran = _adaptor(ad.copy())
    ran.run_highly_variable_genes(**params)
    want = dict(zip(ran.adata.var_names, ran.adata.var['highly_variable'].values))
    got = dict(zip(preview['genes'], preview['highly_variable']))
    assert got == {g: bool(want[g]) for g in got}
    # every gene the run flags is on the plot
    assert {g for g, v in want.items() if v} <= {g for g, v in got.items() if v}
    assert preview['n_highly_variable'] == int(ran.adata.var['highly_variable'].sum())


def test_on_a_cell_selection_the_flags_match_a_run_on_that_selection():
    ad = _adata()
    cells = list(range(0, 200, 2))
    params = dict(flavor='seurat', n_top_genes=25)
    preview = _adaptor(ad.copy()).preview_highly_variable_genes(active_cell_indices=cells, **params)
    ran = _adaptor(ad.copy())
    ran.run_highly_variable_genes(active_cell_indices=cells, **params)
    hv = ran.adata.var['highly_variable']
    assert {g for g, v in zip(preview['genes'], preview['highly_variable']) if v} == set(hv.index[hv.values])
    assert preview['n_cells'] == len(cells)


def test_a_preview_changes_nothing():
    a = _adaptor()
    var_before = a.adata.var.copy()
    n_steps = len(a.analysis_record.steps)
    a.preview_highly_variable_genes(flavor='seurat', n_top_genes=20)
    assert list(a.adata.var.columns) == list(var_before.columns)
    assert len(a.analysis_record.steps) == n_steps


def test_the_axes_are_the_columns_the_thresholds_apply_to():
    """min_mean / max_mean cut scanpy's `means`, min_disp its
    `dispersions_norm`, so those are the axes and the threshold lines sit on
    them; with n_top_genes set the thresholds do nothing and are not drawn."""
    a = _adaptor()
    out = a.preview_highly_variable_genes(flavor='seurat', n_top_genes=None, min_mean=0.1, max_mean=2.0, min_disp=0.4)
    assert out['y_label'].startswith('normalized dispersion')
    assert out['thresholds'] == {'min_mean': 0.1, 'max_mean': 2.0, 'min_disp': 0.4}
    x, y = np.array(out['x']), np.array(out['y'])
    flagged = np.array(out['highly_variable'])
    assert ((x[flagged] > 0.1) & (x[flagged] < 2.0) & (y[flagged] > 0.4)).all()
    assert a.preview_highly_variable_genes(flavor='seurat', n_top_genes=20)['thresholds'] is None


def test_genes_without_a_dispersion_are_left_off_and_counted():
    out = _adaptor().preview_highly_variable_genes(flavor='seurat', n_top_genes=20)
    assert out['n_genes'] == 120
    assert out['n_plotted'] == len(out['genes']) == len(out['x']) == len(out['y'])
    assert out['n_plotted'] <= 115
    for g in ('g0', 'g1', 'g4'):
        assert g not in out['genes']


def test_an_infinite_dispersion_is_pinned_to_the_edge_and_marked():
    """cell_ranger flags genes whose bin has zero MAD with +inf; they must be
    on the plot (at the top) or the preview shows fewer genes than it says."""
    out = _adaptor().preview_highly_variable_genes(flavor='cell_ranger', n_top_genes=30)
    off = np.array(out['off_scale'])
    assert off.any()
    y = np.array(out['y'])
    assert (y[off] == y[~off].max()).all()
    assert sum(out['highly_variable']) == out['n_highly_variable']


def test_it_is_strict_json():
    out = _adaptor().preview_highly_variable_genes(flavor='cell_ranger', n_top_genes=30)
    json.dumps(out, allow_nan=False)


def test_seurat_v3_plots_normalized_variance_on_a_log_mean_axis():
    pytest.importorskip('skmisc')
    ad = _adata()
    ad.X = ad.layers['counts'].copy()
    out = _adaptor(ad).preview_highly_variable_genes(flavor='seurat_v3', n_top_genes=20)
    assert out['x_log'] is True
    assert out['y_label'].startswith('normalized variance')
    assert out['n_highly_variable'] == 20


def test_the_route_serves_it():
    routes.set_adaptor(_adaptor(), slot='primary')
    resp = TestClient(app).post('/api/scanpy/highly_variable_genes/preview',
                                json={'flavor': 'seurat', 'n_top_genes': 20})
    assert resp.status_code == 200, resp.text
    assert resp.json()['n_highly_variable'] == 20


def test_a_bad_flavor_is_a_400():
    routes.set_adaptor(_adaptor(), slot='primary')
    resp = TestClient(app).post('/api/scanpy/highly_variable_genes/preview', json={'flavor': 'nope'})
    assert resp.status_code == 400
