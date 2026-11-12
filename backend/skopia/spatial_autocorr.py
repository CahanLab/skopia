"""Spatial autocorrelation (Moran's I / Geary's C) with progress reporting.

squidpy's ``spatial_autocorr`` is one blocking call with no progress hook, and
with permutations it can run for many minutes on a large section. Each gene's
statistic and p-values depend only on that gene's column, so this runs squidpy
on chunks of genes, reports after each, and then does the two steps that span genes: the
multiple-testing correction over the whole table, and squidpy's sort by the
statistic. The analytic columns come out identical to a single call; the
permutation columns differ only by the random draw, which squidpy leaves
unseeded anyway.

One deliberate difference: the correction runs over the finite p-values only.
squidpy hands the raw column to statsmodels' ``multipletests``, which returns
all-NaN if any input is NaN, and a gene with no counts has a NaN p-value. On a
whole-transcriptome run that meant no gene was ever called spatially variable
(3,700 of 39,812 genes were empty on an E12.5 hindlimb section). Those genes
keep NaN; the rest are corrected among themselves.

Pure: takes an AnnData the caller owns (a copy) and returns a DataFrame.
"""
from __future__ import annotations

from typing import Any, Callable

import numpy as np
import pandas as pd

# About twenty progress steps, without chunks so small that the per-chunk cost
# (squidpy copies and row-normalizes the graph, then shuffles it once per
# permutation) starts to matter.
TARGET_CHUNKS = 20
MIN_CHUNK_GENES = 25

Report = Callable[[float | None, str | None], None]


def default_genes(adata: Any) -> list[str]:
    """The genes squidpy tests when given none: highly variable, else all."""
    if "highly_variable" in adata.var:
        return adata.var_names[adata.var["highly_variable"].to_numpy(dtype=bool)].tolist()
    return adata.var_names.tolist()


def spatial_autocorr(
    adata: Any,
    *,
    mode: str = "moran",
    genes: list[str] | None = None,
    n_perms: int | None = None,
    n_jobs: int = 1,
    corr_method: str | None = "fdr_bh",
    report: Report | None = None,
) -> pd.DataFrame:
    import squidpy as sq
    from statsmodels.stats.multitest import multipletests

    gene_list = list(genes) if genes is not None else default_genes(adata)
    n = len(gene_list)
    if n == 0:
        raise ValueError("No genes to test for spatial autocorrelation")
    size = max(MIN_CHUNK_GENES, -(-n // TARGET_CHUNKS))

    def say(frac: float, msg: str) -> None:
        if report is not None:
            report(frac, msg)

    say(0.0, f"Testing 0 / {n:,} genes…")
    parts = []
    for start in range(0, n, size):
        chunk = gene_list[start:start + size]
        parts.append(sq.gr.spatial_autocorr(
            adata, mode=mode, genes=chunk, n_perms=n_perms, n_jobs=n_jobs,
            corr_method=None, copy=True, show_progress_bar=False,
        ))
        done = min(start + size, n)
        say(done / n, f"Tested {done:,} / {n:,} genes")

    df = pd.concat(parts)
    if corr_method is not None:
        for pv in [c for c in df.columns if "pval" in c]:
            raw = df[pv].to_numpy(dtype=float)
            ok = np.isfinite(raw)
            adj = np.full(raw.shape, np.nan)
            if ok.any():
                _, adj[ok], _, _ = multipletests(raw[ok], alpha=0.05, method=corr_method)
            df[f"{pv}_{corr_method}"] = adj
    stat, ascending = ("I", False) if mode == "moran" else ("C", True)
    df.sort_values(by=stat, ascending=ascending, inplace=True)
    return df
