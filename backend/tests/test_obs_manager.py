""".obs manager: list every column with its type and a preview, and edit
columns in bulk — delete several, rename, duplicate, convert type.

Every mutation is one logged step the notebook replays exactly, and the
listing crosses the API, so it must be JSON-clean (no NaN, no inf).
"""
import json

import anndata
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from xcell.adaptor import DataAdaptor
from xcell.api import routes
from xcell.codegen import EXACT, translate
from xcell.main import app

N = 30


def _adata(seed=0):
    rng = np.random.default_rng(seed)
    ad = anndata.AnnData(X=csr_matrix(rng.random((N, 12)).astype(np.float32)))
    ad.var_names = [f'g{i}' for i in range(12)]
    ad.obs_names = [f'c{i}' for i in range(N)]
    ad.obs['cell_type'] = pd.Categorical(['a'] * 15 + ['b'] * 10 + ['c'] * 5)
    ad.obs['is_doublet'] = np.array([True, False] * (N // 2))
    ad.obs['n_genes'] = rng.integers(100, 200, N).astype(np.int64)
    score = rng.random(N)
    score[:4] = np.nan
    ad.obs['score'] = score
    ad.obs['batch_str'] = pd.Series(['s1', 's2', 's3'] * (N // 3), index=ad.obs_names, dtype=object)
    ad.obs['numeric_text'] = pd.Series([str(i) for i in range(N)], index=ad.obs_names, dtype=object)
    ad.obs['yes_no'] = pd.Series(['yes', 'no'] * (N // 2), index=ad.obs_names, dtype=object)
    ad.obs['UCell_Tcell'] = rng.random(N)
    ad.obs['all_nan'] = np.full(N, np.nan)
    ad.uns['cell_type_colors'] = ['#111111', '#222222', '#333333']
    return ad


def _adaptor():
    return DataAdaptor('x.h5ad', adata=_adata())


def _by_name(listing):
    return {c['name']: c for c in listing['columns']}


def _install(monkeypatch, a):
    monkeypatch.setattr(routes, 'get_adaptor', lambda dataset=None: a)
    return TestClient(app)


# --- listing ----------------------------------------------------------------

def test_listing_names_every_column_in_obs_order_with_its_kind():
    a = _adaptor()
    out = a.list_obs_columns()
    assert out['n_cells'] == N
    assert [c['name'] for c in out['columns']] == list(a.adata.obs.columns)
    kinds = {c['name']: c['kind'] for c in out['columns']}
    assert kinds == {
        'cell_type': 'categorical', 'is_doublet': 'boolean', 'n_genes': 'integer',
        'score': 'float', 'batch_str': 'string', 'numeric_text': 'string',
        'yes_no': 'string', 'UCell_Tcell': 'float', 'all_nan': 'float',
    }


def test_listing_counts_unique_and_missing_and_previews_the_top_categories():
    cols = _by_name(_adaptor().list_obs_columns())
    ct = cols['cell_type']
    assert ct['n_unique'] == 3 and ct['n_missing'] == 0
    assert ct['preview']['top'] == [
        {'value': 'a', 'count': 15}, {'value': 'b', 'count': 10}, {'value': 'c', 'count': 5}]
    assert ct['has_colors'] is True
    assert ct['dtype'] == 'category'
    assert cols['is_doublet']['preview']['top'] == [
        {'value': 'True', 'count': 15}, {'value': 'False', 'count': 15}]
    assert cols['batch_str']['n_unique'] == 3


def test_listing_previews_numbers_as_min_median_max_skipping_missing():
    a = _adaptor()
    cols = _by_name(a.list_obs_columns())
    score = cols['score']
    assert score['n_missing'] == 4
    s = a.adata.obs['score'].dropna()
    assert score['preview'] == pytest.approx(
        {'min': float(s.min()), 'median': float(s.median()), 'max': float(s.max())})
    assert cols['n_genes']['preview']['min'] == float(a.adata.obs['n_genes'].min())


def test_a_column_with_no_values_previews_as_none_and_the_listing_is_json_clean():
    a = _adaptor()
    a.adata.obs['has_inf'] = np.array([np.inf] + [1.0] * (N - 1))
    out = a.list_obs_columns()
    cols = _by_name(out)
    assert cols['all_nan']['n_missing'] == N
    assert cols['all_nan']['preview'] == {'min': None, 'median': None, 'max': None}
    # inf is not JSON; the preview spans the finite values
    assert cols['has_inf']['preview'] == {'min': 1.0, 'median': 1.0, 'max': 1.0}
    json.dumps(out, allow_nan=False)


def test_listing_marks_subset_columns_and_tool_prefixes():
    a = _adaptor()
    a.create_cell_subset('chondro', list(range(0, N, 2)))
    a.adata.obs['leiden_chondro'] = pd.Categorical(['0'] * N)
    cols = _by_name(a.list_obs_columns())
    assert cols['subset_chondro']['subset'] == 'chondro'
    assert cols['subset_chondro']['prefix_group'] == 'subset_'
    assert cols['UCell_Tcell']['prefix_group'] == 'UCell_'
    assert cols['leiden_chondro']['prefix_group'] == 'leiden'
    assert cols['cell_type']['subset'] is None and cols['cell_type']['prefix_group'] is None


# --- delete several ---------------------------------------------------------

def test_deleting_several_columns_is_one_step_that_drops_colours_and_subsets():
    a = _adaptor()
    a.create_cell_subset('chondro', list(range(0, N, 2)))
    n_steps = len(a.analysis_record.steps)
    out = a.delete_obs_columns(['cell_type', 'subset_chondro', 'score'])
    assert out == {
        'deleted': ['cell_type', 'subset_chondro', 'score'],
        'dropped_colors': ['cell_type'],
        'subsets_removed': ['chondro'],
    }
    for c in ('cell_type', 'subset_chondro', 'score'):
        assert c not in a.adata.obs.columns
    assert 'cell_type_colors' not in a.adata.uns
    assert 'chondro' not in a.adata.uns['xcell_cell_subsets']
    assert a.list_cell_subsets() == []
    assert len(a.analysis_record.steps) == n_steps + 1
    step = a.analysis_record.steps[-1]
    assert step.action == 'delete_obs_columns'
    assert step.params == {'columns': ['cell_type', 'subset_chondro', 'score']}


def test_a_missing_column_deletes_nothing():
    a = _adaptor()
    with pytest.raises(KeyError, match='nope'):
        a.delete_obs_columns(['score', 'nope'])
    assert 'score' in a.adata.obs.columns


def test_an_empty_delete_is_refused():
    with pytest.raises(ValueError):
        _adaptor().delete_obs_columns([])


def test_the_notebook_replays_the_bulk_delete():
    a = _adaptor()
    a.delete_obs_columns(['cell_type', 'score'])
    t = translate(a.analysis_record.steps[-1])
    assert t.fidelity == EXACT
    ns = {'adata': _adata()}
    exec('\n'.join(t.code), ns)
    assert 'cell_type' not in ns['adata'].obs and 'score' not in ns['adata'].obs
    assert 'cell_type_colors' not in ns['adata'].uns


# --- rename -----------------------------------------------------------------

def test_rename_keeps_position_and_moves_the_colours():
    a = _adaptor()
    before = list(a.adata.obs.columns)
    values = a.adata.obs['cell_type'].copy()
    out = a.rename_obs_column('cell_type', 'lineage')
    assert out == {'column': 'cell_type', 'new_name': 'lineage', 'moved_colors': True}
    assert list(a.adata.obs.columns) == [('lineage' if c == 'cell_type' else c) for c in before]
    assert (a.adata.obs['lineage'].astype(str).values == values.astype(str).values).all()
    assert a.adata.uns['lineage_colors'] == ['#111111', '#222222', '#333333']
    assert 'cell_type_colors' not in a.adata.uns
    step = a.analysis_record.steps[-1]
    assert step.action == 'rename_obs_column'


def test_rename_refuses_an_existing_name_and_an_empty_one():
    a = _adaptor()
    with pytest.raises(ValueError, match='already exists'):
        a.rename_obs_column('cell_type', 'score')
    with pytest.raises(ValueError):
        a.rename_obs_column('cell_type', '   ')
    with pytest.raises(KeyError):
        a.rename_obs_column('nope', 'x')
    assert 'cell_type' in a.adata.obs.columns


def test_new_names_may_not_take_the_subset_prefix():
    # A subset_<x> column with no registry entry would block a later subset
    # named x and look like membership to anything reading by prefix.
    a = _adaptor()
    with pytest.raises(ValueError, match='subset_'):
        a.rename_obs_column('cell_type', 'subset_mine')
    with pytest.raises(ValueError, match='subset_'):
        a.duplicate_obs_column('is_doublet', 'subset_mine')
    assert 'subset_mine' not in a.adata.obs.columns


def test_rename_refuses_a_saved_subsets_column():
    a = _adaptor()
    a.create_cell_subset('chondro', list(range(0, N, 2)))
    with pytest.raises(ValueError, match='chondro'):
        a.rename_obs_column('subset_chondro', 'kept')
    assert 'subset_chondro' in a.adata.obs.columns


def test_the_notebook_replays_the_rename_with_colours():
    a = _adaptor()
    a.rename_obs_column('cell_type', 'lineage')
    t = translate(a.analysis_record.steps[-1])
    assert t.fidelity == EXACT
    ns = {'adata': _adata()}
    exec('\n'.join(t.code), ns)
    assert 'lineage' in ns['adata'].obs and 'cell_type' not in ns['adata'].obs
    assert list(ns['adata'].uns['lineage_colors']) == ['#111111', '#222222', '#333333']


# --- duplicate --------------------------------------------------------------

def test_duplicate_copies_values_and_colours_independently():
    a = _adaptor()
    out = a.duplicate_obs_column('cell_type', 'cell_type_copy')
    assert out == {'column': 'cell_type', 'new_name': 'cell_type_copy', 'copied_colors': True}
    assert (a.adata.obs['cell_type_copy'] == a.adata.obs['cell_type']).all()
    assert a.adata.uns['cell_type_copy_colors'] == a.adata.uns['cell_type_colors']
    a.adata.obs['cell_type_copy'] = a.adata.obs['cell_type_copy'].cat.rename_categories({'a': 'z'})
    assert 'a' in a.adata.obs['cell_type'].cat.categories
    with pytest.raises(ValueError, match='already exists'):
        a.duplicate_obs_column('score', 'cell_type')


# --- convert ----------------------------------------------------------------

def test_convert_numbers_to_categorical_and_drop_stale_colours():
    a = _adaptor()
    a.adata.uns['n_genes_colors'] = ['#000000']
    out = a.convert_obs_column('n_genes', 'categorical')
    assert out['kind'] == 'categorical'
    assert isinstance(a.adata.obs['n_genes'].dtype, pd.CategoricalDtype)
    assert 'n_genes_colors' not in a.adata.uns
    assert a.analysis_record.steps[-1].action == 'convert_obs_column'


def test_convert_categorical_to_string_keeps_missing_missing_and_drops_colours():
    a = _adaptor()
    a.adata.obs['cell_type'] = a.adata.obs['cell_type'].cat.add_categories(['x'])
    a.adata.obs.iloc[0, a.adata.obs.columns.get_loc('cell_type')] = np.nan
    a.convert_obs_column('cell_type', 'string')
    s = a.adata.obs['cell_type']
    assert not isinstance(s.dtype, pd.CategoricalDtype)
    assert pd.isna(s.iloc[0]) and s.iloc[1] == 'a'
    assert 'cell_type_colors' not in a.adata.uns
    assert _by_name(a.list_obs_columns())['cell_type']['kind'] == 'string'


def test_convert_text_to_numeric():
    a = _adaptor()
    out = a.convert_obs_column('numeric_text', 'numeric')
    assert out['kind'] == 'integer'
    assert a.adata.obs['numeric_text'].tolist() == list(range(N))


def test_convert_to_numeric_refuses_with_an_example_of_what_will_not_parse():
    a = _adaptor()
    with pytest.raises(ValueError, match="'s1'"):
        a.convert_obs_column('batch_str', 'numeric')
    assert a.adata.obs['batch_str'].iloc[0] == 's1'


def test_convert_boolean_to_numeric_gives_zero_and_one():
    a = _adaptor()
    a.convert_obs_column('is_doublet', 'numeric')
    assert a.adata.obs['is_doublet'].tolist()[:2] == [1, 0]
    assert _by_name(a.list_obs_columns())['is_doublet']['kind'] == 'integer'


def test_convert_to_boolean_reads_yes_no_and_takes_a_true_value_otherwise():
    a = _adaptor()
    a.convert_obs_column('yes_no', 'boolean')
    assert a.adata.obs['yes_no'].dtype == bool
    assert a.adata.obs['yes_no'].tolist()[:2] == [True, False]
    a.adata.obs['two'] = pd.Categorical(['L', 'R'] * (N // 2))
    with pytest.raises(ValueError, match='true_value'):
        a.convert_obs_column('two', 'boolean')
    a.convert_obs_column('two', 'boolean', true_value='R')
    assert a.adata.obs['two'].tolist()[:2] == [False, True]


def test_convert_to_boolean_refuses_more_than_two_values_and_missing_values():
    a = _adaptor()
    with pytest.raises(ValueError, match='two'):
        a.convert_obs_column('cell_type', 'boolean', true_value='a')
    a.adata.obs['gappy'] = pd.Series(['yes', None] * (N // 2), index=a.adata.obs_names, dtype=object)
    with pytest.raises(ValueError, match='missing'):
        a.convert_obs_column('gappy', 'boolean')


def test_convert_refuses_unknown_targets_no_ops_and_subset_columns():
    a = _adaptor()
    with pytest.raises(ValueError):
        a.convert_obs_column('score', 'datetime')
    with pytest.raises(ValueError, match='already'):
        a.convert_obs_column('cell_type', 'categorical')
    a.create_cell_subset('chondro', list(range(0, N, 2)))
    with pytest.raises(ValueError, match='chondro'):
        a.convert_obs_column('subset_chondro', 'categorical')


@pytest.mark.parametrize('column,to,kw', [
    ('n_genes', 'categorical', {}),
    ('cell_type', 'string', {}),
    ('numeric_text', 'numeric', {}),
    ('is_doublet', 'numeric', {}),
    ('yes_no', 'boolean', {}),
])
def test_the_notebook_replays_each_conversion(column, to, kw):
    a = _adaptor()
    a.convert_obs_column(column, to, **kw)
    t = translate(a.analysis_record.steps[-1])
    assert t.fidelity == EXACT
    ns = {'adata': _adata()}
    exec('\n'.join(t.imports) + '\n' + '\n'.join(t.code), ns)
    replayed = ns['adata'].obs[column]
    live = a.adata.obs[column]
    assert replayed.dtype == live.dtype
    assert replayed.astype(str).tolist() == live.astype(str).tolist()


# --- routes -----------------------------------------------------------------

def test_routes_list_delete_rename_duplicate_convert(monkeypatch):
    a = _adaptor()
    client = _install(monkeypatch, a)
    r = client.get('/api/obs/columns')
    assert r.status_code == 200
    assert [c['name'] for c in r.json()['columns']] == list(a.adata.obs.columns)

    r = client.post('/api/obs/delete_columns', json={'columns': ['score', 'all_nan']})
    assert r.status_code == 200 and r.json()['deleted'] == ['score', 'all_nan']
    assert 'score' not in a.adata.obs and 'all_nan' not in a.adata.obs

    r = client.post('/api/obs/rename_column', json={'column': 'cell_type', 'new_name': 'lineage'})
    assert r.status_code == 200 and 'lineage' in a.adata.obs

    r = client.post('/api/obs/duplicate_column', json={'column': 'lineage', 'new_name': 'lineage2'})
    assert r.status_code == 200 and 'lineage2' in a.adata.obs

    r = client.post('/api/obs/convert_column', json={'column': 'numeric_text', 'to': 'numeric'})
    assert r.status_code == 200
    assert pd.api.types.is_integer_dtype(a.adata.obs['numeric_text'])


def test_routes_map_refusals_to_400_and_missing_columns_to_404(monkeypatch):
    a = _adaptor()
    client = _install(monkeypatch, a)
    r = client.post('/api/obs/convert_column', json={'column': 'batch_str', 'to': 'numeric'})
    assert r.status_code == 400 and "'s1'" in r.json()['detail']
    r = client.post('/api/obs/convert_column', json={'column': 'score', 'to': 'datetime'})
    assert r.status_code == 400
    assert client.post('/api/obs/rename_column',
                       json={'column': 'cell_type', 'new_name': 'score'}).status_code == 400
    assert client.post('/api/obs/rename_column',
                       json={'column': 'nope', 'new_name': 'x'}).status_code == 404
    assert client.post('/api/obs/delete_columns', json={'columns': ['nope']}).status_code == 404
    assert client.post('/api/obs/delete_columns', json={'columns': []}).status_code == 400
    # The listing route sits before /obs/{column}; ordinary columns still resolve.
    assert client.get('/api/obs/is_doublet').status_code == 200


# --- a string column stays a string across save and reload -------------------

def test_string_columns_survive_an_h5ad_round_trip(tmp_path):
    # anndata's write_h5ad turns every object column into a categorical, so a
    # column converted to string came back categorical after File → Save.
    a = _adaptor()
    a.convert_obs_column('cell_type', 'string')
    p = tmp_path / 'x.h5ad'
    a.prepare_export_with_lines().write_h5ad(p)
    b = DataAdaptor(p)
    assert b._obs_kind(b.adata.obs['cell_type']) == 'string'
    assert b._obs_kind(b.adata.obs['batch_str']) == 'string'
    assert b.adata.obs['cell_type'].tolist() == a.adata.obs['cell_type'].tolist()
    # a categorical the user never touched is still categorical
    assert b._obs_kind(b.adata.obs['is_doublet']) == 'boolean'
    # and the one the user made categorical in the meantime wins over a stale record
    b.convert_obs_column('cell_type', 'categorical')
    q = tmp_path / 'y.h5ad'
    b.prepare_export_with_lines().write_h5ad(q)
    assert DataAdaptor(q)._obs_kind(DataAdaptor(q).adata.obs['cell_type']) == 'categorical'


def test_string_columns_with_missing_values_round_trip():
    a = _adaptor()
    a.convert_obs_column('cell_type', 'string')
    a.adata.obs.loc[a.adata.obs_names[:3], 'cell_type'] = None
    e = a.prepare_export_with_lines()
    assert set(e.uns['xcell_string_columns']) >= {'cell_type', 'batch_str', 'numeric_text', 'yes_no'}
    import tempfile, os
    p = os.path.join(tempfile.mkdtemp(), 'x.h5ad')
    e.write_h5ad(p)
    b = DataAdaptor(p)
    col = b.adata.obs['cell_type']
    assert b._obs_kind(col) == 'string' and col.isna().sum() == 3


# --- export as CSV as well as TSV --------------------------------------------

def test_export_annotations_as_csv_or_tsv():
    a = _adaptor()
    tsv = a.export_annotations(['cell_type', 'n_genes'])
    assert tsv.splitlines()[0] == '\tcell_type\tn_genes'
    csv = a.export_annotations(['cell_type', 'n_genes'], fmt='csv')
    assert csv.splitlines()[0] == ',cell_type,n_genes'
    assert '\t' not in csv
    with pytest.raises(ValueError, match='fmt'):
        a.export_annotations(['cell_type'], fmt='xlsx')


def test_export_route_takes_a_format(monkeypatch):
    a = _adaptor()
    client = _install(monkeypatch, a)
    res = client.post('/api/annotations/export', json={'columns': ['cell_type'], 'format': 'csv'})
    assert res.status_code == 200, res.text
    assert res.headers['content-type'].startswith('text/csv')
    assert 'annotations.csv' in res.headers['content-disposition']
    assert res.text.splitlines()[0] == ',cell_type'
    res = client.post('/api/annotations/export', json={'columns': ['cell_type']})
    assert res.headers['content-type'].startswith('text/tab-separated-values')
    assert client.post('/api/annotations/export', json={'columns': ['cell_type'], 'format': 'xlsx'}).status_code == 400
