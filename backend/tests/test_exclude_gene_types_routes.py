"""Exclude Genes by type over HTTP: the bodies the modal sends pass the models.

The request models must take the types dict exactly as the frontend builds
it, or the feature works in pytest (which calls the adaptor) and 422s in the
browser.
"""
from __future__ import annotations

import gzip

import anndata as ad
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from skopia import gene_types as gt
from skopia.adaptor import DataAdaptor
from skopia.api import routes
from skopia.main import app

_ROWS = [
    ('ENSMUSG00000000001', 'Gnai3', 'protein_coding', 'chr3'),
    ('ENSMUSG00000000002', 'Rpl13', 'protein_coding', 'chr8'),
    ('ENSMUSG00000000004', 'Gm42418', 'lncRNA', 'chr17'),
    ('ENSMUSG00000000007', 'Pbsn', 'processed_pseudogene', 'chrX'),
    ('ENSMUSG00000000012', 'Rps6ka1', 'protein_coding', 'chr4'),
]
GENES = ['Gnai3', 'Rpl13', 'Gm42418', 'Pbsn', 'Rps6ka1', 'tdTomato']
TYPES = {'classes': ['lncRNA', 'pseudogene', 'small_rna', 'ig_tr', 'other'],
         'sets': ['mt', 'ribo', 'predicted'], 'species': 'mouse'}


@pytest.fixture(autouse=True)
def _fixture_table(tmp_path, monkeypatch):
    path = tmp_path / 'gene_types_mouse.tsv.gz'
    with gzip.open(path, 'wt') as fh:
        fh.write('gene_id\tsymbol\tgene_type\tchromosome\n')
        for row in _ROWS:
            fh.write('\t'.join(row) + '\n')
    table = gt._read_table(path)
    monkeypatch.setattr(gt, 'load_table', lambda species, path=None: table)


def _install(monkeypatch):
    rng = np.random.default_rng(0)
    X = csr_matrix(rng.poisson(1.0, size=(10, len(GENES))).astype(np.float32))
    a = ad.AnnData(X=X, obs=pd.DataFrame(index=[f'c{i}' for i in range(10)]),
                   var=pd.DataFrame(index=pd.Index(GENES)))
    adaptor = DataAdaptor('x.h5ad', adata=a)
    # The lambda must accept dataset=None: every data-touching route passes it.
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: adaptor)
    return adaptor


def test_summary_route_takes_the_modal_body(monkeypatch):
    _install(monkeypatch)
    body = {'species': None, 'gene_names': None, 'patterns': ['^Rps'], 'types': TYPES}
    r = TestClient(app).post('/api/scanpy/exclude_genes/types', json=body)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s['species'] == 'mouse'
    # Rpl13 (ribo), Gm42418 (lncRNA, predicted), Pbsn (pseudogene); Rps6ka1 by pattern
    assert s['selection']['n_removed'] == 4
    assert s['selection']['added_examples'] == ['Rps6ka1']


def test_summary_route_with_no_selection(monkeypatch):
    _install(monkeypatch)
    r = TestClient(app).post('/api/scanpy/exclude_genes/types', json={})
    assert r.status_code == 200, r.text
    assert r.json()['selection'] is None


def test_exclude_route_takes_types(monkeypatch):
    a = _install(monkeypatch)
    body = {'gene_names': None, 'patterns': ['^Rps'], 'types': TYPES}
    r = TestClient(app).post('/api/scanpy/exclude_genes', json=body)
    assert r.status_code == 200, r.text
    assert r.json()['n_genes_removed'] == 4
    assert list(a.adata.var_names) == ['Gnai3', 'tdTomato']


def test_exclude_route_without_types_still_works(monkeypatch):
    a = _install(monkeypatch)
    r = TestClient(app).post('/api/scanpy/exclude_genes', json={'gene_names': ['Gnai3'], 'patterns': None})
    assert r.status_code == 200, r.text
    assert 'Gnai3' not in a.adata.var_names


def test_annotate_route_takes_the_modal_body(monkeypatch):
    a = _install(monkeypatch)
    body = {'types': TYPES, 'column': 'analysis_genes', 'gene_names': None,
            'patterns': ['^Rps'], 'species': None, 'overwrite': False}
    r = TestClient(app).post('/api/scanpy/annotate_gene_types', json=body)
    assert r.status_code == 200, r.text
    assert r.json()['n_kept'] == 2
    assert a.adata.var['analysis_genes'].tolist() == [True, False, False, False, False, True]


@pytest.mark.parametrize('path,extra', [
    ('/api/scanpy/exclude_genes/types', {}),
    ('/api/scanpy/exclude_genes', {}),
    ('/api/scanpy/annotate_gene_types', {'column': 'analysis_genes'}),
])
def test_unknown_set_is_a_400(monkeypatch, path, extra):
    a = _install(monkeypatch)
    body = {'types': {'classes': [], 'sets': ['ribosomal'], 'species': 'mouse'}, **extra}
    r = TestClient(app).post(path, json=body)
    assert r.status_code == 400
    assert 'ribosomal' in r.json()['detail']
    assert list(a.adata.var_names) == GENES
