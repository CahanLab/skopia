"""Text annotations placed on an embedding: stored in .uns, restored on load."""

import json

import anndata
import numpy as np
import pytest
from fastapi import HTTPException
from scipy.sparse import csr_matrix

from skopia.adaptor import TEXT_ANNOTATIONS_UNS, DataAdaptor
from skopia.api import routes


def _adata(n_cells=40, n_genes=12):
    rng = np.random.default_rng(0)
    X = csr_matrix(rng.poisson(1.0, size=(n_cells, n_genes)).astype(np.float32))
    ad = anndata.AnnData(X=X)
    ad.obs_names = [f'c{i}' for i in range(n_cells)]
    ad.var_names = [f'g{i}' for i in range(n_genes)]
    ad.obsm['X_umap'] = rng.normal(size=(n_cells, 2)).astype(np.float32)
    return ad


def _adaptor(ad=None):
    return DataAdaptor('x.h5ad', adata=ad if ad is not None else _adata())


def _note(**kw):
    base = {'id': 't1', 'embeddingName': 'X_umap', 'x': 1.5, 'y': -2.0, 'text': 'Neural crest'}
    base.update(kw)
    return base


def test_set_stores_in_uns_and_fills_style_defaults():
    a = _adaptor()
    a.set_text_annotations([_note()])

    got = a.get_text_annotations()
    assert len(got) == 1
    assert got[0]['text'] == 'Neural crest'
    assert got[0]['fontSize'] == 14
    assert got[0]['color'] == '#ffffff'
    assert got[0]['visible'] is True
    # A JSON string, so the h5ad writer never sees a nested dict of lists.
    assert isinstance(a.adata.uns[TEXT_ANNOTATIONS_UNS], str)
    assert json.loads(a.adata.uns[TEXT_ANNOTATIONS_UNS])[0]['x'] == 1.5


def test_empty_list_clears_the_key():
    a = _adaptor()
    a.set_text_annotations([_note()])
    a.set_text_annotations([])
    assert a.get_text_annotations() == []
    assert TEXT_ANNOTATIONS_UNS not in a.adata.uns


def test_restored_from_uns_on_load_dropping_bad_entries():
    ad = _adata()
    ad.uns[TEXT_ANNOTATIONS_UNS] = json.dumps([
        _note(),
        _note(id='t2', text=''),            # empty text
        _note(id='t3', embeddingName=None),  # no embedding
        _note(id='t4', x='nan-ish'),         # coordinate not a number
        'not a dict',
    ])
    a = _adaptor(ad)
    assert [t['id'] for t in a.get_text_annotations()] == ['t1']


def test_corrupt_blob_does_not_block_the_load():
    ad = _adata()
    ad.uns[TEXT_ANNOTATIONS_UNS] = '{not json'
    assert _adaptor(ad).get_text_annotations() == []


def test_survives_h5ad_round_trip(tmp_path):
    a = _adaptor()
    a.set_text_annotations([_note(color='#e94560', fontWeight='bold', background='#000000')])
    path = tmp_path / 'rt.h5ad'
    a.prepare_export_with_lines().write_h5ad(path)

    b = DataAdaptor(str(path), adata=anndata.read_h5ad(path))
    got = b.get_text_annotations()
    assert got[0]['color'] == '#e94560'
    assert got[0]['fontWeight'] == 'bold'
    assert got[0]['background'] == '#000000'


def test_refuses_non_finite_coordinates():
    a = _adaptor()
    with pytest.raises(ValueError, match='finite'):
        a.set_text_annotations([_note(x=float('inf'))])
    assert a.get_text_annotations() == []


def test_refuses_empty_text():
    a = _adaptor()
    with pytest.raises(ValueError, match='needs text'):
        a.set_text_annotations([_note(text='   ')])


def test_keeps_a_note_on_a_missing_embedding():
    # Refusing it would fail every later save of the list.
    a = _adaptor()
    a.set_text_annotations([_note(embeddingName='X_gone')])
    assert a.get_text_annotations()[0]['embeddingName'] == 'X_gone'


def test_deleting_a_subset_drops_text_on_its_embedding():
    a = _adaptor()
    a.create_cell_subset('crest', np.arange(10).tolist())
    a.adata.obsm['X_umap_crest'] = np.full((40, 2), np.nan, dtype=np.float32)
    a.adata.obsm['X_umap_crest'][:10] = 0.0
    a.set_text_annotations([_note(), _note(id='t2', embeddingName='X_umap_crest')])

    a.delete_cell_subset('crest', drop_derived=True)

    assert [t['id'] for t in a.get_text_annotations()] == ['t1']


def test_routes_round_trip(monkeypatch):
    a = _adaptor()
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)

    out = routes.set_text_annotations(
        routes.SetTextAnnotationsRequest(annotations=[routes.TextAnnotationData(**_note())]))
    assert out == {'status': 'ok', 'count': 1}
    assert routes.get_text_annotations()['annotations'][0]['text'] == 'Neural crest'


def test_route_maps_bad_note_to_400(monkeypatch):
    a = _adaptor()
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    with pytest.raises(HTTPException) as e:
        routes.set_text_annotations(routes.SetTextAnnotationsRequest(
            annotations=[routes.TextAnnotationData(**_note(text=''))]))
    assert e.value.status_code == 400
