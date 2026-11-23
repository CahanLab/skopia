"""PCA with an opt-in gene scaling step.

Scaling (z-scoring each gene, clipped at 10 SD as scanpy's tutorial does) gives
every gene the same weight in the components; leaving it off keeps expression
magnitude as a measure of how informative a gene is. sc-best-practices leaves it
off, so off is the default and the option must never touch ``.X`` itself.
"""
import anndata
import numpy as np
import scanpy as sc
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from skopia.adaptor import DataAdaptor
from skopia.api import routes
from skopia.codegen import SKOPIA, translate
from skopia.analysis_record import AnalysisRecord
from skopia.main import app


def _adata(n_cells=80, n_genes=40, n_hvg=25):
    rng = np.random.default_rng(0)
    # Genes on very different scales, so scaling visibly changes the PCA.
    scales = np.linspace(0.1, 8.0, n_genes)
    X = (rng.poisson(1.0, size=(n_cells, n_genes)) * scales).astype(np.float32)
    ad = anndata.AnnData(X=csr_matrix(X))
    ad.var_names = [f'g{i}' for i in range(n_genes)]
    ad.obs_names = [f'c{i}' for i in range(n_cells)]
    hv = np.zeros(n_genes, dtype=bool)
    hv[:n_hvg] = True
    ad.var['highly_variable'] = hv
    return ad


def _adaptor(ad=None):
    return DataAdaptor('x.h5ad', adata=ad if ad is not None else _adata())


def _expected(ad, n_comps, scale):
    sub = ad[:, ad.var['highly_variable'].values].copy()
    if scale:
        sc.pp.scale(sub, max_value=10)
    sc.tl.pca(sub, n_comps=n_comps, svd_solver='arpack', mask_var=None)
    return sub


def test_scaled_pca_is_scanpy_scale_then_pca_over_the_hvgs():
    ad = _adata()
    a = _adaptor(ad.copy())
    a.run_pca(n_comps=5, scale=True)
    want = _expected(ad, 5, scale=True)
    np.testing.assert_allclose(np.abs(a.adata.obsm['X_pca']), np.abs(want.obsm['X_pca']), rtol=1e-4, atol=1e-4)


def test_scaling_leaves_the_expression_matrix_alone():
    ad = _adata()
    before = ad.X.toarray().copy()
    a = _adaptor(ad)
    a.run_pca(n_comps=5, scale=True)
    np.testing.assert_array_equal(a.adata.X.toarray(), before)


def test_unscaled_is_the_default_and_differs_from_scaled():
    ad = _adata()
    a = _adaptor(ad.copy())
    out = a.run_pca(n_comps=5)
    assert out['scaled'] is False
    unscaled = np.abs(a.adata.obsm['X_pca']).copy()
    np.testing.assert_allclose(unscaled, np.abs(_expected(ad, 5, scale=False).obsm['X_pca']), rtol=1e-4, atol=1e-4)
    out = a.run_pca(n_comps=5, scale=True)
    assert out['scaled'] is True
    assert not np.allclose(unscaled, np.abs(a.adata.obsm['X_pca']), atol=1e-3)


def test_scaled_loadings_are_nan_for_genes_outside_the_pca():
    a = _adaptor()
    a.run_pca(n_comps=5, scale=True)
    pcs = a.adata.varm['PCs']
    hv = a.adata.var['highly_variable'].values
    assert np.isfinite(pcs[hv]).all()
    assert np.isnan(pcs[~hv]).all()


def test_scaled_pca_on_a_cell_selection_leaves_other_cells_nan():
    a = _adaptor()
    a.run_pca(n_comps=5, scale=True, active_cell_indices=list(range(40)))
    X = a.adata.obsm['X_pca']
    assert np.isfinite(X[:40]).all()
    assert np.isnan(X[40:]).all()


def test_scaled_pca_on_an_explicit_gene_subset():
    ad = _adata()
    ad.var['first10'] = np.arange(ad.n_vars) < 10
    a = _adaptor(ad)
    out = a.run_pca(n_comps=4, scale=True, gene_subset='first10')
    assert out['n_genes_used'] == 10
    sub = ad[:, :10].copy()
    sc.pp.scale(sub, max_value=10)
    sc.tl.pca(sub, n_comps=4, svd_solver='arpack', mask_var=None)
    np.testing.assert_allclose(np.abs(a.adata.obsm['X_pca']), np.abs(sub.obsm['X_pca']), rtol=1e-4, atol=1e-4)


def test_the_recorded_step_names_the_scaling():
    a = _adaptor()
    a.run_pca(n_comps=5, scale=True)
    params = a.analysis_record.steps[-1].params
    assert params['scale'] is True


def test_codegen_hands_a_scaled_pca_to_the_skopia_api():
    """scanpy has no scale flag on pca; the copy-scale-pca-copy-back dance is
    skopia's, so the honest line is the adaptor call that does it."""
    step = AnalysisRecord().add_step(
        'pca', {'n_comps': 30, 'svd_solver': 'arpack', 'gene_subset': None, 'scale': True}, {})
    t = translate(step)
    assert t.fidelity == SKOPIA
    assert 'scale=True' in '\n'.join(t.code)


def test_the_route_accepts_scale():
    a = _adaptor()
    routes.set_adaptor(a, slot='primary')
    resp = TestClient(app).post('/api/scanpy/pca', json={'n_comps': 5, 'scale': True})
    assert resp.status_code == 200, resp.text
    assert resp.json()['scaled'] is True
