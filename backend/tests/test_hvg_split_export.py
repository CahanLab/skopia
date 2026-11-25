"""The code export and prose of a split (per-group) HVG run.

A split run writes skopia's own columns (``highly_variable__<group>``, union,
intersection), which ``sc.pp.highly_variable_genes`` cannot produce and whose
arguments it refuses, so the honest export is the adaptor call. The test runs
the exported line on a fresh adaptor and compares every column it writes.
"""
import anndata
import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix

from skopia.adaptor import DataAdaptor
from skopia.codegen import SKOPIA, translate


def _adata():
    rng = np.random.default_rng(0)
    counts = rng.poisson(rng.gamma(0.6, 2.0, size=120), size=(200, 120)).astype(np.float32)
    ad = anndata.AnnData(X=csr_matrix(np.log1p(counts)))
    ad.var_names = [f'g{i}' for i in range(120)]
    ad.obs_names = [f'c{i}' for i in range(200)]
    ad.obs['sample'] = pd.Categorical(['a'] * 100 + ['b'] * 95 + ['c'] * 5)
    keep = np.ones(120, dtype=bool)
    keep[::3] = False
    ad.var['analysis_genes'] = keep
    return ad


SPLIT = dict(split_by='sample', n_top_genes=20, flavor='seurat',
             add_union=True, add_intersection=True)


@pytest.mark.parametrize('extra', [{}, {'gene_subset': 'analysis_genes'}])
def test_a_split_run_exports_the_adaptor_call_and_it_reproduces_the_columns(extra):
    a = DataAdaptor('x.h5ad', adata=_adata())
    out = a.run_highly_variable_genes(**SPLIT, **extra)
    t = translate(a.analysis_record.steps[-1])
    assert t.fidelity == SKOPIA
    assert len(t.code) == 1 and t.code[0].startswith('xa.run_highly_variable_genes(')
    fresh = DataAdaptor('x.h5ad', adata=_adata())
    exec('\n'.join(t.code), {'xa': fresh})
    assert out['columns'] == ['highly_variable__a', 'highly_variable__b',
                              'highly_variable__union', 'highly_variable__intersection']
    for col in out['columns']:
        np.testing.assert_array_equal(fresh.adata.var[col].values, a.adata.var[col].values, err_msg=col)


def test_the_summary_of_a_split_run_gives_its_groups_and_counts():
    a = DataAdaptor('x.h5ad', adata=_adata())
    out = a.run_highly_variable_genes(**SPLIT)
    summary = translate(a.analysis_record.steps[-1]).summary
    assert '?' not in summary
    assert '`sample`' in summary and '2 groups' in summary
    assert f"{out['n_union']} variable in any group" in summary
    assert f"{out['n_intersection']} in every group" in summary
    assert '1 group skipped' in summary  # 'c' has 5 cells, under the default 10


def test_the_summary_of_a_split_run_names_its_gene_subset():
    a = DataAdaptor('x.h5ad', adata=_adata())
    a.run_highly_variable_genes(**SPLIT, gene_subset='analysis_genes')
    assert '`analysis_genes`' in translate(a.analysis_record.steps[-1]).summary
