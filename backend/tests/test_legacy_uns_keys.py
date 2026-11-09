"""Files written before the rename carry ``uns`` keys prefixed ``xcell_``;
the adaptor renames them to ``skopia_`` once, on load, so every reader in the
code base sees one prefix. Nothing else may read or write ``xcell_`` keys."""

from __future__ import annotations

import json

import anndata
import numpy as np
import pandas as pd
from scipy.sparse import csr_matrix

from skopia.adaptor import DataAdaptor, LEGACY_UNS_PREFIX, UNS_PREFIX


def _adata() -> anndata.AnnData:
    rng = np.random.default_rng(0)
    X = csr_matrix(rng.poisson(1.0, size=(20, 5)).astype(np.float32))
    obs = pd.DataFrame(
        {'note': pd.Categorical(['a', 'b'] * 10)},
        index=[f'c{i}' for i in range(20)],
    )
    var = pd.DataFrame(index=[f'g{i}' for i in range(5)])
    ad = anndata.AnnData(X=X, obs=obs, var=var)
    ad.obsm['scores'] = rng.random((20, 2)).astype(np.float32)
    ad.uns['xcell_score_matrices'] = {'scores': {'columns': ['s1', 's2']}}
    ad.uns['xcell_figures'] = json.dumps([])
    # The string-column record must be migrated *before* it is applied.
    ad.uns['xcell_string_columns'] = ['note']
    ad.uns['other_tool_key'] = 1
    return ad


def test_prefixes_are_what_the_migration_assumes():
    assert UNS_PREFIX == 'skopia_'
    assert LEGACY_UNS_PREFIX == 'xcell_'


def test_legacy_keys_are_renamed_on_load():
    a = DataAdaptor('x.h5ad', adata=_adata())
    uns = a.adata.uns
    assert not [k for k in uns if k.startswith('xcell_')]
    assert uns['skopia_score_matrices'] == {'scores': {'columns': ['s1', 's2']}}
    assert uns['skopia_figures'] == '[]'
    assert uns['other_tool_key'] == 1
    # The migrated string-column record was applied and consumed.
    assert 'skopia_string_columns' not in uns
    assert a.adata.obs['note'].dtype == object


def test_new_key_wins_when_both_exist():
    ad = _adata()
    ad.uns['skopia_figures'] = json.dumps([{'id': 'f1'}])
    a = DataAdaptor('x.h5ad', adata=ad)
    assert a.adata.uns['skopia_figures'] == json.dumps([{'id': 'f1'}])
    assert 'xcell_figures' not in a.adata.uns


def test_migrated_matrix_registry_is_visible_to_the_schema():
    a = DataAdaptor('x.h5ad', adata=_adata())
    assert 'scores' in a.get_schema()['score_matrices']


def test_round_trip_through_h5ad(tmp_path):
    path = tmp_path / 'legacy.h5ad'
    _adata().write_h5ad(path)
    a = DataAdaptor(path)
    assert 'skopia_score_matrices' in a.adata.uns
    assert not [k for k in a.adata.uns if k.startswith('xcell_')]


def test_no_code_still_names_the_legacy_prefix():
    """One place knows the old prefix: the constant the migration uses."""
    import pathlib
    import skopia
    root = pathlib.Path(skopia.__file__).parent
    hits = []
    for p in root.rglob('*.py'):
        for i, line in enumerate(p.read_text().splitlines(), 1):
            if 'xcell_' in line and 'LEGACY_UNS_PREFIX' not in line:
                hits.append(f'{p.relative_to(root)}:{i}')
    assert hits == []
