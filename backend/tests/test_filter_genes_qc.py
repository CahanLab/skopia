"""Filter Genes: the per-gene distributions its threshold histograms draw.

Mirrors the Filter Cells endpoint: one value per gene for the two quantities
``sc.pp.filter_genes`` thresholds on (total counts, cells expressing), plus
the cell count the UI needs to turn its percentage input into a count.
"""
import numpy as np
import pandas as pd
import anndata
from scipy.sparse import csr_matrix

from xcell.adaptor import DataAdaptor
from xcell.api import routes


def _adata() -> anndata.AnnData:
    # per-gene totals: g0 20, g1 19, g2 11, g3 0; cells expressing: 5, 4, 2, 0
    X = np.array([
        [1, 1, 1, 0],
        [5, 5, 0, 0],
        [1, 0, 0, 0],
        [10, 10, 10, 0],
        [3, 3, 0, 0],
    ], dtype=np.float32)
    return anndata.AnnData(
        X=csr_matrix(X),
        obs=pd.DataFrame(index=[f'c{i}' for i in range(5)]),
        var=pd.DataFrame(index=[f'g{i}' for i in range(4)]),
    )


def test_qc_distributions_report_per_gene_counts_and_cells():
    a = DataAdaptor('dummy.h5ad', adata=_adata())
    qc = a.filter_genes_qc()
    assert qc['counts'] == [20.0, 19.0, 11.0, 0.0]
    assert qc["cells"] == [5, 4, 2, 0]
    assert qc['n_cells'] == 5
    assert all(type(v) is float for v in qc['counts'])
    assert all(type(v) is int for v in qc['cells'])


def test_qc_works_on_a_dense_matrix():
    ad = _adata()
    ad.X = ad.X.toarray()
    qc = DataAdaptor('dummy.h5ad', adata=ad).filter_genes_qc()
    assert qc["cells"] == [5, 4, 2, 0]


def test_qc_route_returns_distributions(monkeypatch):
    a = DataAdaptor('dummy.h5ad', adata=_adata())
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    out = routes.filter_genes_qc(dataset=None)
    assert out['counts'][0] == 20.0
    assert out['n_cells'] == 5
