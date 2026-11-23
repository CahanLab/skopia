"""A gene list made into a boolean .var column.

Gene sets live in the browser; a .var column lives in the file, and is what
every gene-subset picker (PCA, marker genes, NMF, ...) and qc_vars read. The
column must flag exactly the listed genes the dataset has, report the ones it
lacks, and never clobber a column by accident.
"""
import anndata
import numpy as np
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from skopia.adaptor import DataAdaptor
from skopia.analysis_record import AnalysisRecord
from skopia.api import routes
from skopia.codegen import EXACT, translate
from skopia.main import app


def _adaptor():
    rng = np.random.default_rng(0)
    ad = anndata.AnnData(X=csr_matrix(rng.random((6, 5)).astype(np.float32)))
    ad.var_names = ['Sox2', 'Pou5f1', 'Nanog', 'Gata6', 'Actb']
    ad.obs_names = [f'c{i}' for i in range(6)]
    ad.var['label'] = ['a', 'b', 'c', 'd', 'e']
    return DataAdaptor('x.h5ad', adata=ad)


def test_flags_exactly_the_listed_genes_the_dataset_has():
    a = _adaptor()
    out = a.add_var_boolean_from_genes('pluri', ['Nanog', 'Sox2', 'Klf4'])
    assert a.adata.var['pluri'].dtype == bool
    assert a.adata.var['pluri'].tolist() == [True, False, True, False, False]
    assert out['n_genes_matched'] == 2
    assert out['missing'] == ['Klf4']


def test_none_of_the_genes_present_is_refused():
    a = _adaptor()
    with pytest.raises(ValueError, match='none of the 2 genes'):
        a.add_var_boolean_from_genes('x', ['Klf4', 'Myc'])
    assert 'x' not in a.adata.var.columns


def test_an_empty_name_is_refused():
    with pytest.raises(ValueError, match='name'):
        _adaptor().add_var_boolean_from_genes('  ', ['Sox2'])


def test_an_existing_column_is_kept_unless_overwrite_is_asked_for():
    a = _adaptor()
    a.add_var_boolean_from_genes('pluri', ['Sox2'])
    with pytest.raises(ValueError, match='already exists'):
        a.add_var_boolean_from_genes('pluri', ['Nanog'])
    assert a.adata.var['pluri'].tolist() == [True, False, False, False, False]
    a.add_var_boolean_from_genes('pluri', ['Nanog'], overwrite=True)
    assert a.adata.var['pluri'].tolist() == [False, False, True, False, False]


def test_a_non_boolean_column_is_never_overwritten():
    a = _adaptor()
    with pytest.raises(ValueError, match='not boolean'):
        a.add_var_boolean_from_genes('label', ['Sox2'], overwrite=True)
    assert a.adata.var['label'].tolist() == ['a', 'b', 'c', 'd', 'e']


def test_the_column_is_listed_as_a_boolean_column():
    a = _adaptor()
    a.add_var_boolean_from_genes('pluri', ['Sox2', 'Nanog'])
    cols = {c['name']: c for c in a.get_var_boolean_columns()}
    assert cols['pluri']['n_true'] == 2


def test_the_step_is_recorded_and_codegen_reproduces_it():
    a = _adaptor()
    a.add_var_boolean_from_genes('pluri', ['Sox2', 'Nanog', 'Klf4'])
    step = a.analysis_record.steps[-1]
    assert step.action == 'add_var_boolean_from_genes'
    t = translate(step)
    assert t.fidelity == EXACT
    ns = {'adata': a.adata.copy()}
    ns['adata'].var.drop(columns='pluri', inplace=True)
    exec('\n'.join(t.code), ns)
    assert ns['adata'].var['pluri'].tolist() == a.adata.var['pluri'].tolist()


def test_the_route():
    a = _adaptor()
    routes.set_adaptor(a, slot='primary')
    client = TestClient(app)
    resp = client.post('/api/var/boolean_from_genes', json={'name': 'pluri', 'genes': ['Sox2', 'Klf4']})
    assert resp.status_code == 200, resp.text
    assert resp.json()['n_genes_matched'] == 1
    assert a.adata.var['pluri'].sum() == 1
    resp = client.post('/api/var/boolean_from_genes', json={'name': 'pluri', 'genes': ['Nanog']})
    assert resp.status_code == 400
