"""Highly Variable Genes restricted to a gene subset.

A boolean .var column (Exclude Genes' Mark writes one) names the genes HVG
detection may consider. The contract: the flags equal scanpy's own call on
those genes alone, a gene outside the subset is never highly variable, the
preview flags what the run writes, and the code export reproduces the column.
"""
import anndata
import numpy as np
import pandas as pd
import pytest
import scanpy as sc
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from skopia.adaptor import DataAdaptor
from skopia.analysis_record import Step
from skopia.api import routes
from skopia.codegen import EXACT, SKOPIA, translate
from skopia.main import app


def _adata(n_cells=200, n_genes=120):
    rng = np.random.default_rng(0)
    rates = rng.gamma(0.6, 2.0, size=n_genes)
    counts = rng.poisson(rates, size=(n_cells, n_genes)).astype(np.float32)
    counts[:, :5] = 0  # unexpressed genes have no dispersion
    ad = anndata.AnnData(X=csr_matrix(counts))
    ad.var_names = [f'g{i}' for i in range(n_genes)]
    ad.obs_names = [f'c{i}' for i in range(n_cells)]
    X = counts / np.maximum(counts.sum(1, keepdims=True), 1) * 1e4
    ad.X = csr_matrix(np.log1p(X).astype(np.float32))
    # The kept-genes column a Mark writes: every third gene left out, so the
    # subset changes both which genes compete and how the bins fall.
    keep = np.ones(n_genes, dtype=bool)
    keep[::3] = False
    keep[:5] = True  # the unexpressed genes stay in the subset
    ad.var['analysis_genes'] = keep
    ad.var['second'] = np.arange(n_genes) < 90
    return ad


def _adaptor(ad=None):
    return DataAdaptor('x.h5ad', adata=ad if ad is not None else _adata())


PARAMS = dict(flavor='seurat', n_top_genes=20, min_mean=0.0125, max_mean=3.0, min_disp=0.5)


def _scanpy_on(ad, genes_mask, cells=None):
    """scanpy's own flags on the given genes (and cells), over every gene."""
    sub = ad[:, genes_mask]
    if cells is not None:
        sub = sub[cells]
        sub = sub[:, np.asarray(sub.X.sum(axis=0)).ravel() > 0]
    sub = sub.copy()
    sc.pp.highly_variable_genes(sub, **PARAMS)
    return ad.var_names.isin(sub.var_names[sub.var['highly_variable'].values])


def test_a_run_flags_scanpys_choice_among_the_subset_only():
    ad = _adata()
    keep = ad.var['analysis_genes'].values
    a = _adaptor(ad.copy())
    out = a.run_highly_variable_genes(gene_subset='analysis_genes', **PARAMS)
    hv = a.adata.var['highly_variable'].values.astype(bool)
    assert not hv[~keep].any()
    np.testing.assert_array_equal(hv, _scanpy_on(ad, keep))
    assert hv.sum() == 20 == out['n_highly_variable']
    assert out['n_genes_considered'] == int(keep.sum())
    # The subset changes the answer, or this test proves nothing.
    whole = ad.copy()
    sc.pp.highly_variable_genes(whole, **PARAMS)
    assert not np.array_equal(hv, whole.var['highly_variable'].values)


def test_the_run_is_recorded_with_its_gene_subset():
    a = _adaptor()
    a.run_highly_variable_genes(gene_subset='analysis_genes', **PARAMS)
    step = a.analysis_record.steps[-1]
    assert step.action == 'highly_variable_genes'
    assert step.params['gene_subset'] == 'analysis_genes'


def test_no_gene_subset_records_none_and_runs_as_before():
    ad = _adata()
    a = _adaptor(ad.copy())
    a.run_highly_variable_genes(**PARAMS)
    whole = ad.copy()
    sc.pp.highly_variable_genes(whole, **PARAMS)
    np.testing.assert_array_equal(a.adata.var['highly_variable'].values, whole.var['highly_variable'].values)
    assert 'gene_subset' not in a.analysis_record.steps[-1].params


def test_a_two_column_subset_combines_the_columns():
    ad = _adata()
    a = _adaptor(ad.copy())
    a.run_highly_variable_genes(
        gene_subset={'columns': ['analysis_genes', 'second'], 'operation': 'intersection'}, **PARAMS)
    both = ad.var['analysis_genes'].values & ad.var['second'].values
    np.testing.assert_array_equal(a.adata.var['highly_variable'].values.astype(bool), _scanpy_on(ad, both))


def test_a_cell_selection_and_a_gene_subset_apply_together():
    ad = _adata()
    keep = ad.var['analysis_genes'].values
    cells = np.arange(0, 200, 2)
    a = _adaptor(ad.copy())
    a.run_highly_variable_genes(gene_subset='analysis_genes', active_cell_indices=cells.tolist(), **PARAMS)
    np.testing.assert_array_equal(
        a.adata.var['highly_variable'].values.astype(bool), _scanpy_on(ad, keep, cells))


def test_a_named_cell_subset_writes_its_own_column_within_the_genes():
    ad = _adata()
    keep = ad.var['analysis_genes'].values
    cells = np.arange(100)
    a = _adaptor(ad.copy())
    a.create_cell_subset('early', cells.tolist())
    out = a.run_highly_variable_genes(gene_subset='analysis_genes', cell_subset='early', **PARAMS)
    assert out['column'] == 'highly_variable__early'
    np.testing.assert_array_equal(
        a.adata.var['highly_variable__early'].values, _scanpy_on(ad, keep, cells))
    derived = a._subset_registry()['early']['derived']['hvg']
    assert derived['params']['gene_subset'] == 'analysis_genes'


def test_a_split_run_detects_within_the_genes_in_every_group():
    ad = _adata()
    ad.obs['sample'] = pd.Categorical(['a'] * 100 + ['b'] * 100)
    keep = ad.var['analysis_genes'].values
    a = _adaptor(ad.copy())
    out = a.run_highly_variable_genes(gene_subset='analysis_genes', split_by='sample', **PARAMS)
    assert out['columns'] == ['highly_variable__a', 'highly_variable__b']
    np.testing.assert_array_equal(
        a.adata.var['highly_variable__a'].values, _scanpy_on(ad, keep, np.arange(100)))
    np.testing.assert_array_equal(
        a.adata.var['highly_variable__b'].values, _scanpy_on(ad, keep, np.arange(100, 200)))
    assert a.analysis_record.steps[-1].params['gene_subset'] == 'analysis_genes'


def test_subset_true_keeps_only_highly_variable_genes_from_the_subset():
    ad = _adata()
    keep = ad.var['analysis_genes'].values
    a = _adaptor(ad.copy())
    a.run_highly_variable_genes(gene_subset='analysis_genes', subset=True, **PARAMS)
    assert a.adata.n_vars == 20
    assert set(a.adata.var_names) <= set(ad.var_names[keep])


def test_an_unknown_column_is_refused_and_nothing_is_written():
    a = _adaptor()
    with pytest.raises((ValueError, KeyError)):
        a.run_highly_variable_genes(gene_subset='nope', **PARAMS)
    assert 'highly_variable' not in a.adata.var


def test_the_preview_flags_what_the_run_writes_among_the_subset():
    ad = _adata()
    keep = ad.var['analysis_genes'].values
    preview = _adaptor(ad.copy()).preview_highly_variable_genes(gene_subset='analysis_genes', **PARAMS)
    a = _adaptor(ad.copy())
    a.run_highly_variable_genes(gene_subset='analysis_genes', **PARAMS)
    flagged = {g for g, h in zip(preview['genes'], preview['highly_variable']) if h}
    assert flagged == set(a.adata.var_names[a.adata.var['highly_variable'].values.astype(bool)])
    assert set(preview['genes']) <= set(ad.var_names[keep])
    assert preview['n_genes'] == int(keep.sum())


def _install(a, monkeypatch):
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)


@pytest.mark.parametrize('path', ['/api/scanpy/highly_variable_genes',
                                  '/api/scanpy/highly_variable_genes/preview'])
def test_both_routes_take_every_gene_subset_shape(path, monkeypatch):
    a = _adaptor()
    _install(a, monkeypatch)
    client = TestClient(app)
    for subset in ('analysis_genes', {'columns': ['analysis_genes', 'second'], 'operation': 'union'}):
        res = client.post(path, json={**PARAMS, 'gene_subset': subset})
        assert res.status_code == 200, res.text


def test_the_run_route_passes_the_gene_subset_on(monkeypatch):
    ad = _adata()
    a = _adaptor(ad.copy())
    _install(a, monkeypatch)
    res = TestClient(app).post('/api/scanpy/highly_variable_genes',
                               json={**PARAMS, 'gene_subset': 'analysis_genes'})
    assert res.status_code == 200, res.text
    np.testing.assert_array_equal(
        a.adata.var['highly_variable'].values.astype(bool),
        _scanpy_on(ad, ad.var['analysis_genes'].values))


def _step(params, result=None):
    return Step(index=0, action='highly_variable_genes', params=params,
                result=result or {}, timestamp='2026-11-25T00:00:00')


def test_the_export_of_a_one_column_subset_is_exact_and_reproduces_the_columns():
    ad = _adata()
    a = _adaptor(ad.copy())
    a.run_highly_variable_genes(gene_subset='analysis_genes', **PARAMS)
    t = translate(a.analysis_record.steps[-1])
    assert t.fidelity == EXACT
    scope = {'adata': ad.copy(), 'sc': sc, 'np': np, 'pd': pd}
    exec('\n'.join(t.code), scope)
    out = scope['adata']
    for col in ('highly_variable', 'means', 'dispersions', 'dispersions_norm'):
        np.testing.assert_array_equal(out.var[col].values, a.adata.var[col].values, err_msg=col)


def test_the_export_of_subset_true_drops_the_same_genes():
    ad = _adata()
    a = _adaptor(ad.copy())
    a.run_highly_variable_genes(gene_subset='analysis_genes', subset=True, **PARAMS)
    t = translate(a.analysis_record.steps[-1])
    scope = {'adata': ad.copy(), 'sc': sc, 'np': np, 'pd': pd}
    exec('\n'.join(t.code), scope)
    assert list(scope['adata'].var_names) == list(a.adata.var_names)


def test_the_export_of_a_combined_subset_is_the_adaptor_call():
    t = translate(_step({**PARAMS, 'subset': False,
                         'gene_subset': {'columns': ['analysis_genes', 'second'], 'operation': 'union'}}))
    assert t.fidelity == SKOPIA
    assert 'run_highly_variable_genes(' in t.code[0] and 'gene_subset=' in t.code[0]


def test_the_summary_names_the_gene_subset():
    a = _adaptor()
    a.run_highly_variable_genes(gene_subset='analysis_genes', **PARAMS)
    t = translate(a.analysis_record.steps[-1])
    assert 'analysis_genes' in t.summary
