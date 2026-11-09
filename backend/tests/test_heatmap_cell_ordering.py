"""Heatmap cell (column) ordering by similarity.

``cell_ordering='similarity'`` clusters the cells on the selected genes
(average linkage on per-gene min-max scaled expression) and lays the columns
out in dendrogram leaf order before binning, so cells of the same kind sit
together; ``'category_then_similarity'`` does that inside each category
block, like ``'category_then_position'``. Above a cell cap the clustering
runs on k-means centroids instead of the cells, since average linkage needs
the full distance matrix.
"""
import anndata
import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix

from skopia import heatmap
from skopia.adaptor import DataAdaptor
from skopia.heatmap import compute_heatmap_data

N = 60
GENES = ['g1', 'g2', 'g3', 'g4']


def _adata():
    """Two cell populations interleaved by index: even cells express g1/g2,
    odd cells express g3/g4. ``batch`` splits the cells into two halves,
    each holding both populations, so a category-then-similarity run has
    something to cluster inside every block."""
    rng = np.random.default_rng(0)
    pop = np.arange(N) % 2  # 0 = even (g1/g2), 1 = odd (g3/g4)
    X = rng.normal(0, 0.05, (N, len(GENES)))
    X[pop == 0, 0:2] += rng.uniform(5, 10, (N // 2, 2))
    X[pop == 1, 2:4] += rng.uniform(5, 10, (N // 2, 2))
    X = np.clip(X, 0, None).astype(np.float32)
    obs = pd.DataFrame({
        'pop': pd.Categorical(np.where(pop == 0, 'even', 'odd')),
        'batch': pd.Categorical(['b1'] * (N // 2) + ['b2'] * (N // 2)),
    }, index=[f'c{i}' for i in range(N)])
    return anndata.AnnData(X=csr_matrix(X), obs=obs, var=pd.DataFrame(index=GENES))


def _run(**kw):
    a = DataAdaptor('dummy.h5ad', adata=_adata())
    return compute_heatmap_data(a, genes=GENES, **kw)


def _runs(row):
    """Number of contiguous runs of high (>0.5) values in a normalised row."""
    high = np.asarray(row) > 0.5
    return int(np.sum(np.diff(high.astype(int)) != 0)) + 1


def _g1_row(out):
    return np.array(out['matrix'])[out['row_labels'].index('g1')]


def test_similarity_makes_each_population_contiguous():
    out = _run(cell_ordering='similarity')
    row = _g1_row(out)
    assert len(row) == N and out['n_cells'] == N
    assert np.sum(row > 0.5) == N // 2
    assert _runs(row) == 2, row  # one block of even cells, one of odd
    assert out['cell_ordering_method'] == 'exact'
    assert _runs(_g1_row(_run(cell_ordering='none'))) == N  # the input was interleaved


def test_similarity_survives_binning():
    out = _run(cell_ordering='similarity', n_bins=10)
    row = _g1_row(out)
    assert len(row) == 10 and out['n_bins'] == 10
    assert _runs(row) == 2, row


def test_similarity_ignores_a_category_column_and_draws_no_groups():
    out = _run(cell_ordering='similarity', obs_column='batch')
    assert out['column_groups'] == []
    assert _runs(_g1_row(out)) == 2


def test_category_then_similarity_clusters_inside_each_block():
    out = _run(cell_ordering='category_then_similarity', obs_column='batch')
    assert out['column_groups'] == [
        {'name': 'b1', 'start': 0, 'size': N // 2},
        {'name': 'b2', 'start': N // 2, 'size': N // 2},
    ]
    row = _g1_row(out)
    assert _runs(row[: N // 2]) == 2, row[: N // 2]
    assert _runs(row[N // 2:]) == 2, row[N // 2:]
    assert out['cell_ordering_method'] == 'exact'


def test_category_then_similarity_without_a_column_falls_back_to_category_behaviour():
    # like category_then_position without a line: the helper returns the
    # cells unordered rather than guessing; the figure layer refuses it
    out = _run(cell_ordering='category_then_similarity')
    assert out['column_groups'] == []
    assert out['cell_ordering_method'] is None


def test_centroid_path_above_the_cap_still_groups_populations(monkeypatch):
    monkeypatch.setattr(heatmap, 'SIMILARITY_EXACT_MAX_CELLS', 10)
    monkeypatch.setattr(heatmap, 'SIMILARITY_CENTROIDS', 8)
    out = _run(cell_ordering='similarity')
    row = _g1_row(out)
    assert out['cell_ordering_method'] == 'centroids'
    assert np.sum(row > 0.5) == N // 2
    assert _runs(row) == 2, row


def test_centroid_path_is_deterministic(monkeypatch):
    monkeypatch.setattr(heatmap, 'SIMILARITY_EXACT_MAX_CELLS', 10)
    monkeypatch.setattr(heatmap, 'SIMILARITY_CENTROIDS', 8)
    a = _run(cell_ordering='similarity')['matrix']
    b = _run(cell_ordering='similarity')['matrix']
    assert a == b


def test_centroid_path_inside_category_blocks(monkeypatch):
    monkeypatch.setattr(heatmap, 'SIMILARITY_EXACT_MAX_CELLS', 10)
    monkeypatch.setattr(heatmap, 'SIMILARITY_CENTROIDS', 6)
    out = _run(cell_ordering='category_then_similarity', obs_column='batch')
    row = _g1_row(out)
    assert out['cell_ordering_method'] == 'centroids'
    assert _runs(row[: N // 2]) == 2 and _runs(row[N // 2:]) == 2


def test_similarity_with_fewer_than_three_cells_keeps_the_order():
    a = DataAdaptor('dummy.h5ad', adata=_adata())
    out = compute_heatmap_data(a, genes=GENES, cell_ordering='similarity', cell_indices=[1, 0])
    assert out['n_cells'] == 2
    assert out['cell_ordering_method'] == 'exact'
    assert _g1_row(out).tolist() == [0.0, 1.0]  # odd cell first, as given


def test_other_orderings_report_no_method():
    assert _run(cell_ordering='none')['cell_ordering_method'] is None
    assert _run(cell_ordering='category', obs_column='batch')['cell_ordering_method'] is None


def test_unknown_cell_ordering_is_refused():
    with pytest.raises(ValueError, match='cell_ordering'):
        _run(cell_ordering='random')


# --- figure layer -------------------------------------------------------------

def test_figure_refuses_category_then_similarity_without_a_column_and_degrades_a_default():
    a = DataAdaptor('x.h5ad', adata=_adata())
    sets = [{'name': 's', 'genes': GENES}]
    with pytest.raises(ValueError, match='column'):
        a.create_figure('expression_heatmap', inputs={'gene_sets': sets},
                        params={'cell_ordering': 'category_then_similarity'})
    f = a.create_figure('expression_heatmap', inputs={'gene_sets': sets}, params={'cell_ordering': 'similarity'})
    assert a.figure_data(f['id'])['cell_ordering_method'] == 'exact'
    g = a.create_figure('expression_heatmap', inputs={'gene_sets': sets, 'obs_column': 'batch'},
                        params={'cell_ordering': 'category_then_similarity'})
    assert [c['name'] for c in a.figure_data(g['id'])['column_groups']] == ['b1', 'b2']
    assert a._compatible_ordering({}, 'category_then_similarity') == 'similarity'
    assert a._compatible_ordering({'obs_column': 'batch'}, 'category_then_similarity') == 'category_then_similarity'
