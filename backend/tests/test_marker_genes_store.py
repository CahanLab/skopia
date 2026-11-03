"""Marker runs are stored, and top-X-with-filters is a read on the stored table.

Part 1 pins the pure module on a hand-built record; part 2 (below) pins the
adaptor store, the routes and the h5ad round trip.
"""

import json

import anndata
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from scipy.sparse import csr_matrix

from xcell import marker_genes as mg
from xcell.adaptor import DataAdaptor
from xcell.api import routes
from xcell.main import app


# ---------------------------------------------------------------------------
# Pure module
# ---------------------------------------------------------------------------

def _record():
    return {
        'key': 'markers_grp', 'obs_column': 'grp', 'groups': ['a', 'b'],
        'params': {'store_top_n': 5},
        'table': {
            'a': {
                'genes': ['g0', 'g1', 'g2', 'g3', 'g4'],
                'score': [5.0, 4.0, 3.0, 2.0, 1.0],
                'log2fc': [3.0, 1.0, 2.0, None, None],
                'pct_in': [0.9, 0.2, 0.5, 0.1, 0.0],
                'pct_out': [0.1, 0.1, 0.6, 0.0, 0.0],
                'pval': [1e-6, 0.1, 1e-4, 0.9, 0.9],
                'pval_adj': [1e-5, 0.2, 1e-3, 1.0, 1.0],
            },
            'b': {
                'genes': ['g5', 'g6'],
                'score': [2.0, 1.0],
                'log2fc': [1.5, 0.5],
                'pct_in': [0.6, 0.4],
                'pct_out': [0.2, 0.3],
                'pval': [0.01, 0.2],
                'pval_adj': [0.02, 0.3],
            },
        },
    }


def _genes(sel, group):
    return [g['gene'] for g in next(r for r in sel['results'] if r['group'] == group)['genes']]


def test_build_table_keeps_score_order_and_caps():
    groups = ['a', 'b']
    names = pd.DataFrame({'a': ['g0', 'g1', 'g2'], 'b': ['g2', 'g0', 'g1']})
    scores = pd.DataFrame({'a': [3.0, 2.0, 1.0], 'b': [2.5, 1.5, 0.5]})
    lfc = pd.DataFrame({'a': [1.0, 0.5, 0.1], 'b': [2.0, 1.0, 0.2]})
    pv = pd.DataFrame({'a': [0.001, 0.01, 0.1], 'b': [0.002, 0.02, 0.2]})
    pts = pd.DataFrame({'a': [0.9, 0.5, 0.3], 'b': [0.2, 0.4, 0.6]}, index=['g0', 'g1', 'g2'])
    pts_rest = pd.DataFrame({'a': [0.1, 0.2, 0.3], 'b': [0.7, 0.5, 0.3]}, index=['g0', 'g1', 'g2'])
    table = mg.build_table(names, scores, lfc, pv, pv, pts, pts_rest, groups, store_top_n=2)
    assert table['a']['genes'] == ['g0', 'g1']
    assert table['a']['score'] == [3.0, 2.0]
    assert table['b']['genes'] == ['g2', 'g0']
    # pct columns are looked up by gene, not by rank position
    assert table['b']['pct_in'] == [0.6, 0.2]
    assert table['b']['pct_out'] == [0.3, 0.7]
    assert set(table['a']) == {'genes', 'score', 'log2fc', 'pct_in', 'pct_out', 'pval', 'pval_adj'}


def test_build_table_replaces_non_finite_with_none():
    groups = ['a']
    names = pd.DataFrame({'a': ['g0', 'g1', 'g2']})
    scores = pd.DataFrame({'a': [3.0, 2.0, 1.0]})
    lfc = pd.DataFrame({'a': [np.inf, np.nan, -np.inf]})
    pv = pd.DataFrame({'a': [0.001, np.nan, 0.1]})
    pts = pd.DataFrame({'a': [0.9, 0.5, 0.3]}, index=['g0', 'g1', 'g2'])
    table = mg.build_table(names, scores, lfc, pv, pv, pts, pts, groups, store_top_n=10)
    assert table['a']['log2fc'] == [None, None, None]
    assert table['a']['pval'] == [0.001, None, 0.1]
    json.dumps(table)  # no NaN / inf reaches the API


def test_select_default_is_top_n_in_score_order():
    sel = mg.select_markers(_record(), top_n=3)
    assert _genes(sel, 'a') == ['g0', 'g1', 'g2']
    assert _genes(sel, 'b') == ['g5', 'g6']
    g0 = sel['results'][0]['genes'][0]
    assert set(g0) == {'gene', 'score', 'log2fc', 'pct_in', 'pct_out', 'pval', 'pval_adj'}


@pytest.mark.parametrize('kw, expected', [
    ({'min_pct_in': 0.5}, ['g0', 'g2']),
    ({'max_pct_out': 0.5}, ['g0', 'g1', 'g3', 'g4']),
    ({'min_log2fc': 2.0}, ['g0', 'g2']),        # None never passes a threshold
    ({'max_padj': 0.01}, ['g0', 'g2']),
    ({'min_pct_in': 0.5, 'max_padj': 1e-4}, ['g0']),
])
def test_select_applies_inclusive_filters(kw, expected):
    sel = mg.select_markers(_record(), top_n=10, **kw)
    assert _genes(sel, 'a') == expected


def test_select_filters_are_inclusive_at_the_threshold():
    sel = mg.select_markers(_record(), top_n=10, min_pct_in=0.9, max_pct_out=0.1)
    assert _genes(sel, 'a') == ['g0']


def test_select_reports_candidates_and_truncation():
    sel = mg.select_markers(_record(), top_n=1, min_pct_in=0.5)
    a = next(r for r in sel['results'] if r['group'] == 'a')
    assert _genes(sel, 'a') == ['g0']
    assert a['n_candidates'] == 2
    assert sel['n_stored_per_group'] == {'a': 5, 'b': 2}
    # group a holds exactly store_top_n rows, so a filter may have lost candidates
    assert sel['truncated'] is True
    rec = _record()
    rec['params']['store_top_n'] = 50
    assert mg.select_markers(rec, top_n=1)['truncated'] is False


def test_select_rank_by_log2fc_puts_none_last():
    sel = mg.select_markers(_record(), top_n=10, rank_by='log2fc')
    assert _genes(sel, 'a') == ['g0', 'g2', 'g1', 'g3', 'g4']


def test_select_restricts_to_named_groups():
    sel = mg.select_markers(_record(), top_n=10, groups=['b'])
    assert [r['group'] for r in sel['results']] == ['b']


def test_select_rejects_bad_arguments():
    with pytest.raises(ValueError):
        mg.select_markers(_record(), top_n=0)
    with pytest.raises(ValueError):
        mg.select_markers(_record(), top_n=1, rank_by='pval')
    with pytest.raises(ValueError):
        mg.select_markers(_record(), top_n=1, groups=['zzz'])


def test_select_on_a_group_with_no_rows_is_empty():
    rec = _record()
    rec['table']['c'] = {k: [] for k in rec['table']['a']}
    rec['groups'].append('c')
    sel = mg.select_markers(rec, top_n=3)
    c = next(r for r in sel['results'] if r['group'] == 'c')
    assert c['genes'] == [] and c['n_candidates'] == 0


def test_select_restricts_to_an_allowed_gene_list_before_thresholds():
    sel = mg.select_markers(_record(), top_n=1, genes={'g1', 'g2', 'g6', 'nope'})
    assert _genes(sel, 'a') == ['g1'] and _genes(sel, 'b') == ['g6']
    assert sel['results'][0]['n_candidates'] == 2 and sel['restricted'] is True
    # thresholds apply inside the allowed list
    sel = mg.select_markers(_record(), top_n=5, genes={'g1', 'g2'}, min_pct_in=0.5)
    assert _genes(sel, 'a') == ['g2'] and sel['results'][0]['n_candidates'] == 1


def test_select_restriction_with_unknown_names_is_empty():
    sel = mg.select_markers(_record(), genes=['zzz'])
    assert all(r['genes'] == [] and r['n_candidates'] == 0 for r in sel['results'])
    assert sel['restricted'] is True
    assert mg.select_markers(_record())['restricted'] is False


# ---------------------------------------------------------------------------
# Adaptor store and routes
# ---------------------------------------------------------------------------

N_CELLS, N_GENES = 120, 8
GENES = [f"g{i:02d}" for i in range(N_GENES)]


def _adata():
    rng = np.random.default_rng(0)
    X = rng.poisson(1.0, size=(N_CELLS, N_GENES)).astype(np.float32)
    grp = np.array(["a", "b", "c"] * (N_CELLS // 3))
    X[grp == "a", 0] += 8.0      # g00 marks a
    X[grp == "b", 1] += 8.0      # g01 marks b
    X[:, 7] = 0.0                # an all-zero gene: scanpy's log2fc is not finite
    ad = anndata.AnnData(X=csr_matrix(X))
    ad.var_names = GENES
    ad.obs["grp"] = pd.Categorical(grp)
    return ad


def _adaptor():
    return DataAdaptor("x.h5ad", adata=_adata())


def _client(a, monkeypatch):
    monkeypatch.setattr(routes, "get_adaptor", lambda dataset=None: a)
    return TestClient(app)


def _group(result, group):
    return next(r for r in result["results"] if r["group"] == group)


def test_run_stores_a_record_with_pct_columns():
    a = _adaptor()
    r = a.run_marker_genes(obs_column="grp", top_n=3)
    assert r["key"] == "markers_grp" and r["uid"]
    store = a.adata.uns["xcell_marker_genes"]
    assert isinstance(store["markers_grp"], str)
    rec = json.loads(store["markers_grp"])
    assert rec["uid"] == r["uid"] and rec["obs_column"] == "grp" and rec["groups"] == ["a", "b", "c"]
    ta = rec["table"]["a"]
    assert ta["genes"][0] == "g00"
    assert ta["pct_in"][0] > 0.95 and ta["pct_out"][0] < ta["pct_in"][0]
    assert ta["score"] == sorted(ta["score"], reverse=True)
    assert len(ta["genes"]) == N_GENES            # store_top_n default (500) exceeds the gene count
    json.dumps(rec)
    # the response is a selection of the stored table
    g00 = _group(r, "a")["genes"][0]
    assert g00["gene"] == "g00" and {"score", "pct_in", "pct_out", "log2fc", "pval", "pval_adj"} <= set(g00)
    assert _group(r, "a")["n_candidates"] == N_GENES
    assert r["truncated"] is False
    assert r["n_cells_tested"] == N_CELLS


def test_run_truncates_to_store_top_n():
    a = _adaptor()
    r = a.run_marker_genes(obs_column="grp", top_n=2, store_top_n=3)
    rec = json.loads(a.adata.uns["xcell_marker_genes"][r["key"]])
    assert all(len(rec["table"][g]["genes"]) == 3 for g in ("a", "b", "c"))
    assert rec["params"]["store_top_n"] == 3
    assert r["truncated"] is True
    assert len(_group(r, "a")["genes"]) == 2


def test_keys_do_not_collide_and_a_label_is_kept():
    a = _adaptor()
    assert a.run_marker_genes(obs_column="grp", top_n=1)["key"] == "markers_grp"
    r2 = a.run_marker_genes(obs_column="grp", top_n=1, label="second pass")
    assert r2["key"] == "markers_grp_2"
    assert json.loads(a.adata.uns["xcell_marker_genes"]["markers_grp_2"])["label"] == "second pass"
    runs = a.list_marker_runs()
    assert [x["key"] for x in runs] == ["markers_grp_2", "markers_grp"]
    assert runs[0]["label"] == "second pass" and runs[0]["n_groups"] == 3 and runs[0]["n_cells_tested"] == N_CELLS


def test_old_filter_fields_select_post_hoc():
    a = _adaptor()
    r = a.run_marker_genes(obs_column="grp", top_n=10, min_fold_change=4.0, min_in_group_fraction=0.9)
    assert [g["gene"] for g in _group(r, "a")["genes"]] == ["g00"]
    assert [g["gene"] for g in _group(r, "b")["genes"]] == ["g01"]
    # the store still holds the whole ranking: the filters were applied after it
    rec = json.loads(a.adata.uns["xcell_marker_genes"][r["key"]])
    assert len(rec["table"]["a"]["genes"]) == N_GENES
    # and the logged step records the post hoc thresholds under their new names
    step = a.analysis_record.steps[-1]
    assert step.action == "marker_genes" and step.result["key"] == r["key"]
    assert step.params["min_fold_change"] == 4.0


def test_select_reads_without_rerunning_the_test(monkeypatch):
    import scanpy as sc
    a = _adaptor()
    key = a.run_marker_genes(obs_column="grp", top_n=1)["key"]
    monkeypatch.setattr(sc.tl, "rank_genes_groups", lambda *a_, **k: (_ for _ in ()).throw(AssertionError("re-ran")))
    sel = a.select_marker_genes(key, top_n=2, min_pct_in=0.5)
    assert sel["key"] == key and sel["obs_column"] == "grp"
    assert len(_group(sel, "a")["genes"]) == 2
    groups = a.marker_gene_set_groups(key, top_n=1)
    assert groups == [{"name": "a", "genes": ["g00"]}, {"name": "b", "genes": ["g01"]},
                      {"name": "c", "genes": groups[2]["genes"]}]
    # a selection is a read: nothing is logged
    assert [s.action for s in a.analysis_record.steps].count("marker_genes") == 1


def test_adaptor_restricts_from_a_gene_list_and_a_boolean_column():
    a = _adaptor()
    key = a.run_marker_genes(obs_column='grp', top_n=3, store_top_n=10)['key']
    full = a.select_marker_genes(key, top_n=2)
    first = full['results'][0]['genes'][0]['gene']
    sel = a.select_marker_genes(key, top_n=2, restrict_to={'label': 'one', 'genes': [first, 'zzz']})
    assert [g['gene'] for g in sel['results'][0]['genes']] == [first] and sel['restricted'] is True
    assert sel['restrict_to'] == {'label': 'one', 'genes': [first, 'zzz']}
    a.adata.var['flag'] = [g == first for g in a.adata.var_names]          # bool dtype
    a.adata.var['flag01'] = a.adata.var['flag'].astype(int)                  # numeric 0/1 counts too
    for col in ('flag', 'flag01'):
        sel = a.select_marker_genes(key, top_n=2, restrict_to={'label': col, 'var_column': col})
        assert [g['gene'] for g in sel['results'][0]['genes']] == [first]
    a.adata.var['n_cells'] = np.arange(a.adata.n_vars)
    with pytest.raises(ValueError, match='boolean'):
        a.select_marker_genes(key, restrict_to={'label': 'x', 'var_column': 'n_cells'})
    with pytest.raises(KeyError):
        a.select_marker_genes(key, restrict_to={'label': 'x', 'var_column': 'ghost'})
    with pytest.raises(ValueError, match='names no genes'):
        a.select_marker_genes(key, restrict_to={'label': 'x', 'genes': []})
    with pytest.raises(ValueError):
        a.select_marker_genes(key, restrict_to={'label': 'x', 'genes': ['g00'], 'var_column': 'flag'})
    # a stored ranking holds weak markers too, so a restriction keeps the gene
    # in every group whose stored rows have it; the plot path dedupes later
    groups = a.marker_gene_set_groups(key, top_n=2, restrict_to={'label': 'one', 'genes': [first]})
    assert groups[0] == {'name': full['results'][0]['group'], 'genes': [first]}
    assert all(g['genes'] == [first] for g in groups)


def test_select_route_takes_restrict_to(monkeypatch):
    a = _adaptor()
    key = a.run_marker_genes(obs_column='grp', top_n=3, store_top_n=10)['key']
    c = _client(a, monkeypatch)
    first = c.post(f'/api/marker_genes/runs/{key}/select', json={'top_n': 1}).json()['results'][0]['genes'][0]['gene']
    r = c.post(f'/api/marker_genes/runs/{key}/select', json={'top_n': 5, 'restrict_to': {'label': 'one', 'genes': [first]}})
    assert r.status_code == 200 and [g['gene'] for g in r.json()['results'][0]['genes']] == [first]
    assert c.post(f'/api/marker_genes/runs/{key}/select', json={'restrict_to': {'label': 'x', 'genes': []}}).status_code == 422
    assert c.post(f'/api/marker_genes/runs/{key}/select', json={'restrict_to': {'label': 'x'}}).status_code == 422


def test_select_route_and_run_list_route(monkeypatch):
    a = _adaptor()
    client = _client(a, monkeypatch)
    res = client.post("/api/marker-genes", json={"obs_column": "grp", "top_n": 2})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["key"] == "markers_grp" and body["uid"] and "truncated" in body
    assert _group(body, "a")["genes"][0]["pct_in"] > 0.9
    runs = client.get("/api/marker_genes/runs").json()["runs"]
    assert runs[0]["key"] == "markers_grp"
    rec = client.get("/api/marker_genes/runs/markers_grp").json()
    assert "table" not in rec and rec["uid"] == body["uid"]
    assert "table" in client.get("/api/marker_genes/runs/markers_grp", params={"table": "true"}).json()
    sel = client.post("/api/marker_genes/runs/markers_grp/select",
                      json={"top_n": 1, "min_pct_in": 0.9, "rank_by": "log2fc"})
    assert sel.status_code == 200, sel.text
    assert [g["gene"] for g in _group(sel.json(), "a")["genes"]] == ["g00"]
    assert client.post("/api/marker_genes/runs/nope/select", json={"top_n": 1}).status_code == 404
    assert client.post("/api/marker_genes/runs/markers_grp/select", json={"top_n": 1, "rank_by": "x"}).status_code == 400


def test_delete_logs_and_removes(monkeypatch):
    a = _adaptor()
    client = _client(a, monkeypatch)
    key = a.run_marker_genes(obs_column="grp", top_n=1)["key"]
    assert client.delete(f"/api/marker_genes/runs/{key}").status_code == 200
    assert key not in a.adata.uns["xcell_marker_genes"]
    assert a.analysis_record.steps[-1].action == "marker_genes_delete"
    assert client.delete(f"/api/marker_genes/runs/{key}").status_code == 404
    with pytest.raises(KeyError):
        a.select_marker_genes(key, top_n=1)


def test_record_survives_h5ad_round_trip(tmp_path):
    a = _adaptor()
    key = a.run_marker_genes(obs_column="grp", top_n=1)["key"]
    path = tmp_path / "out.h5ad"
    a.adata.write_h5ad(path)
    b = DataAdaptor("x.h5ad", adata=anndata.read_h5ad(path))
    assert [g["gene"] for g in _group(b.select_marker_genes(key, top_n=1), "b")["genes"]] == ["g01"]


def test_the_notebook_summary_names_the_stored_run():
    from xcell.codegen import translate
    a = _adaptor()
    a.run_marker_genes(obs_column="grp", top_n=3)
    t = translate(a.analysis_record.steps[-1])
    assert "markers_grp" in t.summary and "enrichment" not in t.summary


# ---------------------------------------------------------------------------
# Heatmap from a marker run
# ---------------------------------------------------------------------------

def test_heatmap_route_accepts_a_marker_source(monkeypatch):
    a = _adaptor()
    client = _client(a, monkeypatch)
    key = a.run_marker_genes(obs_column="grp", top_n=1)["key"]
    res = client.post("/api/heatmap/data", json={
        "genes": [], "markers": {"key": key, "top_n": 2},
        "cell_ordering": "category", "obs_column": "grp", "n_bins": 0,
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["row_groups"][:2] == ["a", "a"]
    assert set(body["row_groups"]) == {"a", "b", "c"}
    assert body["row_labels"][0] == "g00"
    assert len(body["row_labels"]) <= 6
    assert [c["name"] for c in body["column_groups"]] == ["a", "b", "c"]


def test_heatmap_route_mixes_marker_groups_with_gene_sets(monkeypatch):
    a = _adaptor()
    client = _client(a, monkeypatch)
    key = a.run_marker_genes(obs_column="grp", top_n=1)["key"]
    res = client.post("/api/heatmap/data", json={
        "genes": ["g05"], "gene_set_groups": [{"name": "extra", "genes": ["g05"]}],
        "markers": {"key": key, "top_n": 1},
    })
    assert res.status_code == 200, res.text
    assert res.json()["row_groups"][-1] == "extra"


def test_heatmap_route_refuses_an_unknown_marker_key(monkeypatch):
    a = _adaptor()
    client = _client(a, monkeypatch)
    res = client.post("/api/heatmap/data", json={"genes": [], "markers": {"key": "nope", "top_n": 2}})
    assert res.status_code == 404
