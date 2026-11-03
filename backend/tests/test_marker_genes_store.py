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
