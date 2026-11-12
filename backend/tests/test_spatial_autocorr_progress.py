"""Spatial autocorrelation reports progress by testing genes in chunks.

squidpy's ``spatial_autocorr`` is one blocking call with no progress hook, so
the adaptor runs it on gene chunks and applies the multiple-testing correction
once over the whole table. These tests pin that the chunked run is the
single call's result, not an approximation of it.
"""
import anndata as ad
import numpy as np
import pandas as pd
import pytest
from scipy.sparse import csr_matrix

from skopia.adaptor import DataAdaptor


def _adata(n=300, n_genes=90, seed=0):
    rng = np.random.default_rng(seed)
    coords = rng.uniform(0, 100, size=(n, 2))
    # Half the genes follow x (spatially patterned), half are noise.
    X = rng.poisson(1.0, size=(n, n_genes)).astype(np.float32)
    X[:, : n_genes // 2] += (coords[:, :1] / 20).astype(np.float32)
    a = ad.AnnData(
        X=csr_matrix(X),
        obs=pd.DataFrame(index=[f"c{i}" for i in range(n)]),
        var=pd.DataFrame(index=[f"g{i}" for i in range(n_genes)]),
    )
    a.obsm["spatial"] = coords
    import squidpy as sq
    sq.gr.spatial_neighbors(a, coord_type="generic", n_neighs=6)
    return a


def _adaptor(a=None):
    return DataAdaptor("x.h5ad", adata=a if a is not None else _adata())


def test_compute_reports_rising_progress_that_ends_at_one():
    a = _adaptor()
    compute_fn, _ = a.prepare_spatial_autocorr(mode="moran", n_perms=None)
    seen = []
    compute_fn(lambda frac, msg=None: seen.append((frac, msg)))
    fracs = [f for f, _ in seen if f is not None]
    assert len(fracs) >= 3, seen
    assert fracs == sorted(fracs)
    assert fracs[-1] == pytest.approx(1.0)
    # The message says how far through the genes it is.
    assert any(m and "genes" in m for _, m in seen)


@pytest.mark.parametrize("mode,stat", [("moran", "I"), ("geary", "C")])
def test_chunked_result_matches_one_squidpy_call(mode, stat):
    import squidpy as sq

    raw = _adata()
    expected = sq.gr.spatial_autocorr(
        raw.copy(), mode=mode, n_perms=None, corr_method="fdr_bh",
        copy=True, show_progress_bar=False,
    )
    a = _adaptor(raw)
    compute_fn, _ = a.prepare_spatial_autocorr(mode=mode, n_perms=None)
    got = compute_fn(lambda *_: None)["results_df"]

    # Same genes, same order (squidpy sorts by the statistic), same numbers;
    # the FDR column is the one that would drift if it were applied per chunk.
    assert list(got.index) == list(expected.index)
    for col in (stat, "pval_norm", "var_norm", "pval_norm_fdr_bh"):
        np.testing.assert_allclose(got[col].to_numpy(), expected[col].to_numpy(), rtol=1e-6, err_msg=col)


def test_permutation_columns_are_corrected_over_every_gene():
    from statsmodels.stats.multitest import multipletests

    a = _adaptor()
    compute_fn, _ = a.prepare_spatial_autocorr(mode="moran", n_perms=20)
    df = compute_fn(lambda *_: None)["results_df"]
    assert len(df) == 90
    for pv in ("pval_sim", "pval_z_sim", "pval_norm"):
        _, adj, _, _ = multipletests(df[pv].to_numpy(), method="fdr_bh")
        np.testing.assert_allclose(df[f"{pv}_fdr_bh"].to_numpy(), adj)


def test_without_a_gene_list_it_tests_highly_variable_genes_as_squidpy_does():
    raw = _adata()
    raw.var["highly_variable"] = [i % 3 == 0 for i in range(raw.n_vars)]
    a = _adaptor(raw)
    compute_fn, apply_fn = a.prepare_spatial_autocorr(mode="moran", n_perms=None)
    out = apply_fn(compute_fn(lambda *_: None))
    assert out["n_tested"] == 30
    assert set(a.adata.uns["moranI"].index) == set(raw.var_names[raw.var["highly_variable"]])


def test_a_gene_with_no_counts_does_not_wipe_out_every_adjusted_p_value():
    # statsmodels' multipletests returns all-NaN if any input is NaN, and a
    # gene that is zero everywhere has a NaN p-value. squidpy corrects the
    # raw column as is, so one empty gene meant no gene was ever called on a
    # whole-transcriptome run (3,700 of 39,812 genes on an E12.5 section).
    raw = _adata()
    X = raw.X.toarray()
    X[:, -1] = 0
    raw.X = csr_matrix(X)
    a = _adaptor(raw)
    compute_fn, apply_fn = a.prepare_spatial_autocorr(mode="moran", n_perms=None)
    result = compute_fn(lambda *_: None)
    df = result["results_df"]
    assert np.isnan(df.loc["g89", "pval_norm_fdr_bh"])
    assert df["pval_norm_fdr_bh"].notna().sum() == 89
    out = apply_fn(result)
    assert out["n_spatially_variable"] > 0
