"""Choosing which .obs / .var columns survive a combine, and how.

The dangerous case is a name collision that is not a value collision: two
datasets each carrying `seurat_clusters` from *independent* clusterings, where
cluster 3 in one has nothing to do with cluster 3 in the other. Merging those
into one column invents a comparison. So the default for anything label-shaped
is to keep them apart, and per-cell measurements — which do mean the same
thing everywhere — merge.
"""
import anndata
import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix

from xcell.adaptor import combine_datasets, describe_combine_columns


GENES = [f'g{i}' for i in range(20)]


def _base(n: int, seed: int, genes=None) -> anndata.AnnData:
    rng = np.random.default_rng(seed)
    genes = genes or GENES
    return anndata.AnnData(
        X=csr_matrix(rng.poisson(1.0, size=(n, len(genes))).astype(np.float32)),
        obs=pd.DataFrame(index=[f'c{i}' for i in range(n)]),
        var=pd.DataFrame(index=list(genes)),
    )


def _write(tmp_path, name: str, a: anndata.AnnData):
    p = tmp_path / name
    a.write_h5ad(p)
    return p


def _pair(tmp_path):
    """Two datasets sharing an obs measurement, an obs label, and a var flag."""
    rng = np.random.default_rng(0)
    a, b = _base(30, 1), _base(40, 2)
    for ad, n, seed in ((a, 30, 3), (b, 40, 4)):
        r = np.random.default_rng(seed)
        ad.obs['nCount_RNA'] = r.uniform(500, 5000, n)          # measurement
        ad.obs['seurat_clusters'] = pd.Categorical(
            r.choice(['0', '1', '2'], n)                         # independent labels
        )
        ad.var['highly_variable'] = r.random(len(GENES)) > 0.5   # per-dataset flag
        ad.var['gene_symbol'] = list(GENES)                      # identical everywhere
    a.obs['only_in_a'] = rng.random(30)
    return _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)


# ---------------------------------------------------------------------------
# describe_combine_columns — what the picker shows before you commit
# ---------------------------------------------------------------------------
def _by_name(entries):
    return {e['name']: e for e in entries}


def test_describe_reports_which_datasets_hold_each_column(tmp_path):
    pa, pb = _pair(tmp_path)
    got = describe_combine_columns([pa, pb], ['A', 'B'])
    obs = _by_name(got['obs'])
    assert obs['nCount_RNA']['datasets'] == ['A', 'B']
    assert obs['only_in_a']['datasets'] == ['A']


def test_a_measurement_in_several_datasets_defaults_to_merge(tmp_path):
    pa, pb = _pair(tmp_path)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    assert obs['nCount_RNA']['suggested'] == 'merge'


def test_a_label_in_several_datasets_defaults_to_separate(tmp_path):
    """Independent clusterings must not be silently pooled."""
    pa, pb = _pair(tmp_path)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    assert obs['seurat_clusters']['suggested'] == 'separate'
    assert 'reason' in obs['seurat_clusters']


def test_a_low_cardinality_integer_column_is_treated_as_a_label(tmp_path):
    """Clusters stored as ints are still clusters."""
    a, b = _base(30, 1), _base(40, 2)
    a.obs['cluster'] = np.random.default_rng(1).integers(0, 5, 30)
    b.obs['cluster'] = np.random.default_rng(2).integers(0, 5, 40)
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    assert obs['cluster']['suggested'] == 'separate'


def test_a_column_only_one_dataset_has_defaults_to_merge(tmp_path):
    """No collision is possible, so there is nothing to keep apart."""
    pa, pb = _pair(tmp_path)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    assert obs['only_in_a']['suggested'] == 'merge'


def test_a_var_column_that_is_identical_everywhere_defaults_to_first(tmp_path):
    """gene_symbol says the same thing in every input — one copy is enough."""
    pa, pb = _pair(tmp_path)
    var = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['var'])
    assert var['gene_symbol']['suggested'] == 'first'
    assert var['gene_symbol']['identical'] is True


def test_a_var_column_that_disagrees_defaults_to_separate(tmp_path):
    """Each dataset's own highly_variable is its own answer."""
    pa, pb = _pair(tmp_path)
    var = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['var'])
    assert var['highly_variable']['suggested'] == 'separate'
    assert var['highly_variable']['identical'] is False


def test_describe_compares_var_columns_only_over_shared_genes(tmp_path):
    """Genes outside the intersection are dropped by the combine anyway, so
    disagreement there must not force a column apart."""
    a = _base(30, 1)
    b = _base(40, 2, genes=GENES[:10] + ['extra1', 'extra2'])
    a.var['note'] = ['x'] * len(GENES)
    b.var['note'] = ['x'] * 10 + ['DIFFERENT', 'DIFFERENT']
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    var = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['var'])
    assert var['note']['identical'] is True


# ---------------------------------------------------------------------------
# combine_datasets — applying the policy
# ---------------------------------------------------------------------------
def test_merge_keeps_one_column_with_every_cell_s_own_value(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'], obs_policy={'nCount_RNA': 'merge'})
    assert 'nCount_RNA' in out.obs.columns
    assert out.obs['nCount_RNA'].notna().all()


def test_separate_splits_a_column_per_dataset(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets(
        [pa, pb], ['A', 'B'], obs_policy={'seurat_clusters': 'separate'},
    )
    assert 'seurat_clusters' not in out.obs.columns
    assert 'seurat_clusters__A' in out.obs.columns
    assert 'seurat_clusters__B' in out.obs.columns


def test_a_separated_column_is_empty_for_the_other_dataset_s_cells(tmp_path):
    """The whole point: B's cells have no value in A's clustering."""
    pa, pb = _pair(tmp_path)
    out = combine_datasets(
        [pa, pb], ['A', 'B'], obs_policy={'seurat_clusters': 'separate'},
    )
    is_a = out.obs['sample'] == 'A'
    assert out.obs.loc[is_a, 'seurat_clusters__A'].notna().all()
    assert out.obs.loc[~is_a, 'seurat_clusters__A'].isna().all()
    assert out.obs.loc[~is_a, 'seurat_clusters__B'].notna().all()


def test_drop_removes_a_column_entirely(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'], obs_policy={'nCount_RNA': 'drop'})
    assert not [c for c in out.obs.columns if c.startswith('nCount_RNA')]


def test_columns_absent_from_the_policy_follow_the_suggested_default(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'], obs_policy={})
    assert 'nCount_RNA' in out.obs.columns                # measurement → merged
    assert 'seurat_clusters__A' in out.obs.columns        # labels → separated


def test_no_policy_at_all_keeps_the_previous_behavior_for_shared_columns(tmp_path):
    """Callers that never asked for column control still get their columns."""
    pa, pb = _pair(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'])
    assert 'nCount_RNA' in out.obs.columns
    assert 'sample' in out.obs.columns


def test_var_separate_keeps_each_dataset_s_annotation(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets(
        [pa, pb], ['A', 'B'], var_policy={'highly_variable': 'separate'},
    )
    assert 'highly_variable__A' in out.var.columns
    assert 'highly_variable__B' in out.var.columns
    assert out.var['highly_variable__A'].dtype == bool


def test_var_first_takes_one_copy(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'], var_policy={'gene_symbol': 'first'})
    assert list(out.var['gene_symbol']) == list(out.var_names)


def test_var_drop_removes_the_column(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'], var_policy={'gene_symbol': 'drop'})
    assert 'gene_symbol' not in out.var.columns


def test_separated_names_do_not_collide_with_an_existing_column(tmp_path):
    """A dataset that already has `x__A` must not be overwritten by splitting `x`."""
    a, b = _base(30, 1), _base(40, 2)
    r = np.random.default_rng(5)
    a.obs['x'] = pd.Categorical(r.choice(['p', 'q'], 30))
    b.obs['x'] = pd.Categorical(r.choice(['p', 'q'], 40))
    a.obs['x__A'] = np.arange(30, dtype=float)
    b.obs['x__A'] = np.arange(40, dtype=float)
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    out = combine_datasets(
        [pa, pb], ['A', 'B'],
        obs_policy={'x': 'separate', 'x__A': 'merge'},
    )
    assert 'x__A' in out.obs.columns
    assert out.obs['x__A'].notna().all()          # the pre-existing column, intact
    assert 'x__A_1' in out.obs.columns or 'x__A__A' in out.obs.columns


def test_an_unknown_policy_value_is_rejected(tmp_path):
    pa, pb = _pair(tmp_path)
    with pytest.raises(ValueError, match="policy"):
        combine_datasets([pa, pb], ['A', 'B'], obs_policy={'nCount_RNA': 'nope'})


def test_a_policy_for_a_column_no_dataset_has_is_rejected(tmp_path):
    """A typo silently doing nothing is how you lose a column without noticing."""
    pa, pb = _pair(tmp_path)
    with pytest.raises(ValueError, match="ncount_rna"):
        combine_datasets([pa, pb], ['A', 'B'], obs_policy={'ncount_rna': 'merge'})


def test_the_sample_column_is_always_written(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'], obs_policy={'sample': 'drop'})
    assert 'sample' in out.obs.columns
    assert set(out.obs['sample']) == {'A', 'B'}


def test_the_policy_is_recorded_in_uns(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets(
        [pa, pb], ['A', 'B'], obs_policy={'seurat_clusters': 'separate'},
    )
    rec = out.uns['xcell_combine']
    assert rec['obs_policy']['seurat_clusters'] == 'separate'
    assert rec['obs_policy']['nCount_RNA'] == 'merge'   # resolved default, recorded


def test_spatial_mode_applies_the_policy_too(tmp_path):
    a, b = _base(30, 1), _base(40, 2)
    a.obsm['X_spatial'] = np.random.default_rng(1).uniform(0, 100, (30, 2))
    b.obsm['X_spatial'] = np.random.default_rng(2).uniform(0, 100, (40, 2))
    r = np.random.default_rng(9)
    a.obs['cl'] = pd.Categorical(r.choice(['x', 'y'], 30))
    b.obs['cl'] = pd.Categorical(r.choice(['x', 'y'], 40))
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    out = combine_datasets([pa, pb], ['A', 'B'], obs_policy={'cl': 'separate'})
    assert out.uns['xcell_combine']['mode'] == 'spatial'
    assert 'cl__A' in out.obs.columns


def test_the_combined_result_still_writes_to_h5ad(tmp_path):
    pa, pb = _pair(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'])
    out.write_h5ad(tmp_path / 'combined.h5ad')
    back = anndata.read_h5ad(tmp_path / 'combined.h5ad')
    assert back.n_obs == out.n_obs


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------
def _client():
    from fastapi.testclient import TestClient
    from xcell.main import app
    return TestClient(app)


def test_columns_route_describes_both_axes(tmp_path):
    pa, pb = _pair(tmp_path)
    r = _client().post('/api/combine/columns', json={
        'files': [{'file_path': str(pa), 'label': 'A'},
                  {'file_path': str(pb), 'label': 'B'}],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    obs = _by_name(body['obs'])
    assert obs['seurat_clusters']['suggested'] == 'separate'
    assert obs['nCount_RNA']['suggested'] == 'merge'
    assert _by_name(body['var'])['gene_symbol']['suggested'] == 'first'


def test_columns_route_defaults_labels_from_filenames(tmp_path):
    pa, pb = _pair(tmp_path)
    body = _client().post('/api/combine/columns', json={
        'files': [{'file_path': str(pa)}, {'file_path': str(pb)}],
    }).json()
    assert _by_name(body['obs'])['only_in_a']['datasets'] == ['a']


def test_columns_route_404s_on_a_missing_file(tmp_path):
    pa, _ = _pair(tmp_path)
    r = _client().post('/api/combine/columns', json={
        'files': [{'file_path': str(pa)}, {'file_path': str(tmp_path / 'nope.h5ad')}],
    })
    assert r.status_code == 404


def test_columns_route_needs_two_files(tmp_path):
    pa, _ = _pair(tmp_path)
    r = _client().post('/api/combine/columns',
                       json={'files': [{'file_path': str(pa)}]})
    assert r.status_code == 400


def test_combine_route_applies_the_column_policy(tmp_path):
    pa, pb = _pair(tmp_path)
    r = _client().post('/api/combine', json={
        'files': [{'file_path': str(pa), 'label': 'A'},
                  {'file_path': str(pb), 'label': 'B'}],
        'slot': 'primary',
        'obs_policy': {'seurat_clusters': 'separate', 'nCount_RNA': 'drop'},
    })
    assert r.status_code == 200, r.text
    from xcell.api import routes as _routes
    obs_cols = set(_routes.get_adaptor('primary').adata.obs.columns)
    assert 'seurat_clusters__A' in obs_cols
    assert not [c for c in obs_cols if c.startswith('nCount_RNA')]


def test_combine_route_rejects_a_bad_policy_value(tmp_path):
    pa, pb = _pair(tmp_path)
    r = _client().post('/api/combine', json={
        'files': [{'file_path': str(pa)}, {'file_path': str(pb)}],
        'obs_policy': {'nCount_RNA': 'nope'},
    })
    assert r.status_code == 400
    assert 'policy' in r.json()['detail']


# ---------------------------------------------------------------------------
# shared label vocabularies: same name, same labels → one column by default
# ---------------------------------------------------------------------------
def _labelled(tmp_path, labels_a, labels_b, kind_b='category'):
    """Two datasets with a `cell_type` column drawn from the given vocabularies."""
    a, b = _base(30, 1), _base(40, 2)
    a.obs['cell_type'] = pd.Categorical(np.resize(list(labels_a), 30)) if labels_a else np.nan
    vals_b = np.resize(list(labels_b), 40)
    b.obs['cell_type'] = pd.Categorical(vals_b) if kind_b == 'category' else pd.Series(
        vals_b, index=b.obs_names, dtype=object)
    return _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)


def test_a_label_shared_by_every_dataset_defaults_to_merge(tmp_path):
    """Two files annotated with the same cell-type scheme want one column."""
    pa, pb = _labelled(tmp_path, ['T cell', 'B cell', 'NK'], ['T cell', 'B cell', 'NK'])
    col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['cell_type']
    assert col['suggested'] == 'merge'
    assert col['labels'] == {'shared': 3, 'union': 3}
    assert 'same 3 labels' in col['reason']


def test_a_label_mostly_shared_defaults_to_merge(tmp_path):
    """Same scheme, different tissues: most names overlap, not all."""
    pa, pb = _labelled(tmp_path, ['T cell', 'B cell', 'NK'], ['T cell', 'B cell', 'Mono'])
    col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['cell_type']
    assert col['suggested'] == 'merge'
    assert col['labels'] == {'shared': 2, 'union': 4}
    assert '2 of 4 labels shared' in col['reason']


def test_numeric_looking_labels_stay_separate(tmp_path):
    """Cluster ids overlap by construction and mean nothing across files."""
    for vocab in (['0', '1', '2'], ['C0', 'C1', 'C2']):
        pa, pb = _labelled(tmp_path, vocab, vocab)
        col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['cell_type']
        assert col['suggested'] == 'separate', vocab
        assert 'numbers' in col['reason']
        assert col['labels'] == {'shared': 3, 'union': 3}


def test_a_label_with_little_overlap_stays_separate(tmp_path):
    pa, pb = _labelled(tmp_path, ['T cell', 'B cell'], ['Neuron', 'Glia'])
    col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['cell_type']
    assert col['suggested'] == 'separate'
    assert col['labels'] == {'shared': 0, 'union': 4}


def test_an_all_missing_label_column_stays_separate(tmp_path):
    """No vocabulary on one side is no evidence of a shared scheme. An
    all-missing column comes back from disk as float, so there is nothing to
    compare and the kinds disagree."""
    pa, pb = _labelled(tmp_path, [], ['T cell', 'B cell'])
    col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['cell_type']
    assert col['suggested'] == 'separate'
    assert col['labels'] is None


def test_a_label_whose_kinds_differ_across_datasets_stays_separate(tmp_path):
    """A categorical in one file and free text in the other still share a
    vocabulary; the kinds agree in class, so the overlap rule applies."""
    pa, pb = _labelled(tmp_path, ['T cell', 'B cell'], ['T cell', 'B cell'], kind_b='string')
    col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['cell_type']
    assert col['suggested'] == 'merge'
    # But a number column against a label column is a different thing.
    a, b = _base(30, 1), _base(40, 2)
    a.obs['score'] = np.random.default_rng(1).random(30)
    b.obs['score'] = pd.Categorical(['hi', 'lo'] * 20)
    pa, pb = _write(tmp_path, 'a2.h5ad', a), _write(tmp_path, 'b2.h5ad', b)
    col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['score']
    assert col['suggested'] == 'separate'
    assert 'types differ' in col['reason']


def test_a_measurement_reports_no_labels(tmp_path):
    pa, pb = _pair(tmp_path)
    col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['nCount_RNA']
    assert col['labels'] is None


def test_combine_with_no_policy_pools_a_shared_vocabulary(tmp_path):
    """The combine and the picker share one rule, so a caller that sends no
    policy gets the same default the picker shows."""
    pa, pb = _labelled(tmp_path, ['T cell', 'B cell', 'NK'], ['T cell', 'B cell', 'Mono'])
    out = combine_datasets([pa, pb], ['A', 'B'])
    assert 'cell_type' in out.obs.columns
    assert 'cell_type__A' not in out.obs.columns
    assert out.obs['cell_type'].notna().all()
    assert list(out.obs['cell_type'].cat.categories) == ['B cell', 'NK', 'T cell', 'Mono']
    assert out.uns['xcell_combine']['obs_policy']['cell_type'] == 'merge'


def test_a_category_pooled_with_free_text_keeps_every_value(tmp_path):
    """Restoring the recorded categories after the concat must not turn the
    string side's values into missing."""
    pa, pb = _labelled(tmp_path, ['T cell', 'B cell'], ['T cell', 'Mono'], kind_b='string')
    out = combine_datasets([pa, pb], ['A', 'B'], obs_policy={'cell_type': 'merge'})
    assert out.obs['cell_type'].notna().all()
    assert set(out.obs['cell_type'].cat.categories) == {'T cell', 'B cell', 'Mono'}


# ---------------------------------------------------------------------------
# obs_merge_into: the same labels under different names
# ---------------------------------------------------------------------------
def _renamed(tmp_path, kind_a='category', kind_b='category'):
    """`celltype` in A and `cell_type` in B, one scheme under two names."""
    a, b = _base(30, 1), _base(40, 2)
    va = np.resize(['T cell', 'B cell', 'NK'], 30)
    vb = np.resize(['T cell', 'B cell', 'Mono'], 40)
    a.obs['celltype'] = pd.Categorical(va) if kind_a == 'category' else va
    b.obs['cell_type'] = pd.Categorical(vb) if kind_b == 'category' else vb
    a.obs['leiden'] = pd.Categorical(np.resize(['0', '1'], 30))
    return _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)


def test_merge_into_pools_two_names_into_the_target(tmp_path):
    pa, pb = _renamed(tmp_path)
    out = combine_datasets([pa, pb], ['A', 'B'], obs_merge_into={'celltype': 'cell_type'})
    assert 'cell_type' in out.obs.columns
    assert 'celltype' not in out.obs.columns
    assert out.obs['cell_type'].notna().all()
    assert list(out.obs['cell_type'].cat.categories) == ['B cell', 'NK', 'T cell', 'Mono']
    assert out.obs.loc[out.obs['sample'] == 'A', 'cell_type'].iloc[0] == 'T cell'
    rec = out.uns['xcell_combine']
    assert rec['obs_merge_into'] == {'celltype': 'cell_type'}
    assert rec['obs_policy']['celltype'] == 'merge'
    assert rec['obs_policy']['cell_type'] == 'merge'


def test_merge_into_overrides_a_drop_on_the_source(tmp_path):
    """Saying a column is the same as another is the stronger statement."""
    pa, pb = _renamed(tmp_path)
    out = combine_datasets(
        [pa, pb], ['A', 'B'],
        obs_policy={'celltype': 'drop', 'cell_type': 'separate'},
        obs_merge_into={'celltype': 'cell_type'},
    )
    assert out.obs['cell_type'].notna().all()
    assert 'cell_type__B' not in out.obs.columns


def test_merge_into_refuses_unknown_self_chain_and_shared_holders(tmp_path):
    pa, pb = _renamed(tmp_path)
    with pytest.raises(ValueError, match="No input dataset has .* 'nope'"):
        combine_datasets([pa, pb], ['A', 'B'], obs_merge_into={'nope': 'cell_type'})
    with pytest.raises(ValueError, match="No input dataset has .* 'nope'"):
        combine_datasets([pa, pb], ['A', 'B'], obs_merge_into={'celltype': 'nope'})
    with pytest.raises(ValueError, match='into itself'):
        combine_datasets([pa, pb], ['A', 'B'], obs_merge_into={'celltype': 'celltype'})
    with pytest.raises(ValueError, match='itself merged into'):
        combine_datasets([pa, pb], ['A', 'B'],
                         obs_merge_into={'leiden': 'celltype', 'celltype': 'cell_type'})
    # `leiden` and `celltype` are both in A: a cell would have two values.
    with pytest.raises(ValueError, match="'A' holds both"):
        combine_datasets([pa, pb], ['A', 'B'], obs_merge_into={'leiden': 'celltype'})
    with pytest.raises(ValueError, match='sample'):
        combine_datasets([pa, pb], ['A', 'B'], obs_merge_into={'celltype': 'sample'})


def test_merge_into_refuses_a_class_mismatch(tmp_path):
    a, b = _base(30, 1), _base(40, 2)
    a.obs['score'] = np.random.default_rng(1).random(30)
    b.obs['cell_type'] = pd.Categorical(np.resize(['T cell', 'B cell'], 40))
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    with pytest.raises(ValueError, match='numeric.*label|label.*numeric'):
        combine_datasets([pa, pb], ['A', 'B'], obs_merge_into={'score': 'cell_type'})


def test_describe_names_a_same_as_candidate(tmp_path):
    pa, pb = _renamed(tmp_path)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    col = obs['celltype']
    # Only A has it, so on its own it keeps its default; the hint is added.
    assert col['suggested'] == 'merge'
    assert col['same_as'][0] == {'name': 'cell_type', 'shared': 2, 'union': 4, 'likely': True}
    assert 'looks like `cell_type`' in col['reason']
    assert '2 of 4 labels shared' in col['reason']
    # Symmetric: the other side names this one.
    assert obs['cell_type']['same_as'][0]['name'] == 'celltype'
    # `leiden` is held by A too, so it is never a candidate for A's column.
    assert all(e['name'] != 'leiden' for e in col['same_as'])
    # B's `cell_type` could be declared the same as `leiden`, but nothing
    # suggests it: ids and names share no label.
    assert obs['leiden']['same_as'] == [
        {'name': 'cell_type', 'shared': 0, 'union': 5, 'likely': False}]
    assert obs['leiden']['reason'].startswith('only A has it')


def test_same_as_never_offers_a_column_from_the_same_dataset(tmp_path):
    a, b = _base(30, 1), _base(40, 2)
    a.obs['clusters_a'] = pd.Categorical(np.resize(['0', '1'], 30))
    a.obs['annot'] = pd.Categorical(np.resize(['x', 'y'], 30))
    b.obs['clusters_b'] = pd.Categorical(np.resize(['0', '1'], 40))
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    assert [e['name'] for e in obs['clusters_a']['same_as']] == ['clusters_b']
    assert [e['name'] for e in obs['annot']['same_as']] == ['clusters_b']
    assert 'looks like' not in obs['clusters_a']['reason']


def test_combine_route_accepts_obs_merge_into(tmp_path):
    from xcell.api import routes
    pa, pb = _renamed(tmp_path)
    files = [{'file_path': str(pa), 'label': 'A'}, {'file_path': str(pb), 'label': 'B'}]
    try:
        r = _client().post('/api/combine', json={
            'files': files, 'slot': 'merge_into_test',
            'obs_merge_into': {'celltype': 'cell_type'},
        })
        assert r.status_code == 200, r.text
        ad = routes.get_adaptor('merge_into_test').adata
        assert ad.obs['cell_type'].notna().all()
        r = _client().post('/api/combine', json={
            'files': files, 'slot': 'merge_into_test',
            'obs_merge_into': {'leiden': 'celltype', 'celltype': 'cell_type'},
        })
        assert r.status_code == 400
        assert 'itself merged into' in r.json()['detail']
    finally:
        # A slot left registered makes later "nothing loaded" tests see data.
        routes._adaptors.pop('merge_into_test', None)


# ---------------------------------------------------------------------------
# after review: the Same as list, stage labels, mixed category types
# ---------------------------------------------------------------------------
def test_same_as_lists_every_disjoint_label_column_and_marks_the_likely_ones(tmp_path):
    """The user may know two columns are one scheme even when few names
    overlap, so every candidate is offered; the overlap says which is likely."""
    a, b = _base(30, 1), _base(40, 2)
    a.obs['ct'] = pd.Categorical(np.resize(['T cell', 'B cell', 'NK'], 30))
    a.obs['other_a'] = pd.Categorical(np.resize(['p', 'q'], 30))
    b.obs['celltype'] = pd.Categorical(np.resize(['T cell', 'B cell', 'Mono'], 40))
    b.obs['region'] = pd.Categorical(np.resize(['x', 'y'], 40))
    b.obs['depth'] = np.random.default_rng(3).random(40)
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    assert obs['ct']['same_as'] == [
        {'name': 'celltype', 'shared': 2, 'union': 4, 'likely': True},
        {'name': 'region', 'shared': 0, 'union': 5, 'likely': False},
    ]
    assert 'looks like `celltype`' in obs['ct']['reason']
    assert obs['other_a']['same_as'] == [
        {'name': 'celltype', 'shared': 0, 'union': 5, 'likely': False},
        {'name': 'region', 'shared': 0, 'union': 4, 'likely': False},
    ]
    assert 'looks like' not in obs['other_a']['reason']
    assert obs['depth']['same_as'] == []


def test_the_hint_names_a_likely_candidate_whatever_the_holder_count(tmp_path):
    a, b, c = _base(30, 1), _base(40, 2), _base(20, 3)
    for ad, n in ((a, 30), (b, 40)):
        ad.obs['ct'] = pd.Categorical(np.resize(['T cell', 'B cell'], n))
    c.obs['celltype'] = pd.Categorical(np.resize(['T cell', 'B cell'], 20))
    paths = [_write(tmp_path, f'{k}.h5ad', ad) for k, ad in (('a', a), ('b', b), ('c', c))]
    obs = _by_name(describe_combine_columns(paths, ['A', 'B', 'C'])['obs'])
    assert obs['ct']['suggested'] == 'merge'
    assert 'looks like `celltype` in C' in obs['ct']['reason']


def test_an_existing_sample_column_gets_no_same_as(tmp_path):
    a, b = _base(30, 1), _base(40, 2)
    a.obs['sample'] = pd.Categorical(['s1'] * 30)
    b.obs['batch'] = pd.Categorical(['s1'] * 40)
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    assert obs['sample']['same_as'] == []
    assert obs['batch']['same_as'] == []


def test_numeric_vocabularies_are_offered_but_never_likely(tmp_path):
    a, b = _base(30, 1), _base(40, 2)
    a.obs['clusters_a'] = pd.Categorical(np.resize(['0', '1'], 30))
    b.obs['clusters_b'] = pd.Categorical(np.resize(['0', '1'], 40))
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    obs = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])
    assert obs['clusters_a']['same_as'] == [
        {'name': 'clusters_b', 'shared': 2, 'union': 2, 'likely': False}]
    assert 'looks like' not in obs['clusters_a']['reason']


def test_embryonic_stages_are_labels_not_cluster_ids(tmp_path):
    """E7.5 is a stage every gastrulation dataset carries; C3 and 0 are ids."""
    pa, pb = _labelled(tmp_path, ['E7.5', 'E8.5'], ['E7.5', 'E8.5', 'E9.5'])
    col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['cell_type']
    assert col['suggested'] == 'merge'
    for vocab in (['C3', 'C4'], ['0', '1'], ['1.0', '2.0'], ['cl12', 'cl13']):
        pa, pb = _labelled(tmp_path, vocab, vocab)
        col = _by_name(describe_combine_columns([pa, pb], ['A', 'B'])['obs'])['cell_type']
        assert col['suggested'] == 'separate', vocab


def test_an_integer_categorical_pooled_with_text_writes_to_h5ad(tmp_path):
    a, b = _base(30, 1), _base(40, 2)
    a.obs['ct'] = pd.Categorical(np.resize([1, 2], 30))
    b.obs['ct'] = pd.Series(np.resize(['1', '2', '3'], 40), index=b.obs_names, dtype=object)
    pa, pb = _write(tmp_path, 'a.h5ad', a), _write(tmp_path, 'b.h5ad', b)
    out = combine_datasets([pa, pb], ['A', 'B'], obs_policy={'ct': 'merge'})
    assert out.obs['ct'].notna().all()
    assert list(out.obs['ct'].cat.categories) == ['1', '2', '3']
    out.write_h5ad(tmp_path / 'out.h5ad')
