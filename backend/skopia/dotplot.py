"""Scanpy-style dot plot data: per gene per group, the fraction of cells
with expression above a cutoff (dot size) and the mean expression (dot
color). Pure: takes a dense cells × genes matrix and a per-cell label array.
"""

from __future__ import annotations

from typing import Any

import numpy as np

COLOR_BY = ('mean', 'mean_expressing')
STANDARD_SCALE = ('none', 'gene')
GENE_ORDERINGS = ('as_provided', 'peak_group')
GROUP_ORDERINGS = ('as_given', 'cluster')

_LABELS = {
    ('mean', 'none'): 'Mean expression',
    ('mean_expressing', 'none'): 'Mean expression in expressing cells',
    ('mean', 'gene'): 'Scaled mean expression',
    ('mean_expressing', 'gene'): 'Scaled mean expression in expressing cells',
}


def _row_groups(genes: list[str], gene_set_groups: list[dict[str, Any]] | None) -> list[str | None]:
    """Label each row by the set it came from, walking the sets in order so a
    gene listed in two sets gets each set once (the rows are given twice)."""
    if not gene_set_groups:
        return [None] * len(genes)
    remaining = [(str(s.get('name', '')), list(s.get('genes') or [])) for s in gene_set_groups]
    labels: list[str | None] = []
    for g in genes:
        label = None
        for name, members in remaining:
            if g in members:
                members.remove(g)
                label = name
                break
        labels.append(label)
    return labels


def compute_dotplot(
    expr: np.ndarray,
    categories: np.ndarray,
    genes: list[str],
    gene_set_groups: list[dict[str, Any]] | None = None,
    *,
    expression_cutoff: float = 0.0,
    color_by: str = 'mean',
    standard_scale: str = 'none',
    gene_ordering: str = 'as_provided',
    category_order: list[str] | None = None,
    group_ordering: str = 'as_given',
) -> dict[str, Any]:
    """Dot plot table for ``expr`` (cells × genes, one column per entry of
    ``genes``, duplicates allowed) grouped by ``categories`` (one label per
    cell).

    ``category_order`` fixes the column order (categories absent among the
    cells are dropped); otherwise columns follow first appearance sorted.
    ``gene_ordering='peak_group'`` sorts rows by the column where their mean
    peaks, within gene-set groups when rows are grouped.
    ``group_ordering='cluster'`` reorders the columns by hierarchical
    clustering of their mean-expression profiles (average linkage on the
    per-gene standardised means, leaves in dendrogram order); ``'as_given'``
    keeps ``category_order``. Fewer than three groups are left as given.
    """
    if color_by not in COLOR_BY:
        raise ValueError(f"color_by must be one of {COLOR_BY}, got {color_by!r}")
    if standard_scale not in STANDARD_SCALE:
        raise ValueError(f"standard_scale must be one of {STANDARD_SCALE}, got {standard_scale!r}")
    if gene_ordering not in GENE_ORDERINGS:
        raise ValueError(f"gene_ordering must be one of {GENE_ORDERINGS}, got {gene_ordering!r}")
    if group_ordering not in GROUP_ORDERINGS:
        raise ValueError(f"group_ordering must be one of {GROUP_ORDERINGS}, got {group_ordering!r}")
    expr = np.asarray(expr, dtype=np.float64)
    if expr.ndim != 2 or expr.shape[1] != len(genes):
        raise ValueError('expr must be cells × genes with one column per gene')
    labels = np.asarray(categories).astype(str)
    present = set(labels.tolist())
    if category_order is not None:
        cats = [str(c) for c in category_order if str(c) in present]
    else:
        cats = sorted(present)
    n_per = [int(np.sum(labels == c)) for c in cats]

    expressing = expr > float(expression_cutoff)
    pct = np.zeros((len(genes), len(cats)))
    mean = np.zeros((len(genes), len(cats)))
    for j, c in enumerate(cats):
        rows = labels == c
        n = int(rows.sum())
        if n == 0:
            continue
        on = expressing[rows]
        pct[:, j] = on.sum(axis=0) / n
        if color_by == 'mean':
            mean[:, j] = expr[rows].mean(axis=0)
        else:
            n_on = on.sum(axis=0)
            tot = (expr[rows] * on).sum(axis=0)
            mean[:, j] = np.divide(tot, n_on, out=np.zeros(len(genes)), where=n_on > 0)
    if group_ordering == 'cluster' and len(cats) >= 3 and len(genes):
        col_order = _cluster_columns(mean)
        cats = [cats[j] for j in col_order]
        n_per = [n_per[j] for j in col_order]
        pct = pct[:, col_order]
        mean = mean[:, col_order]
    if standard_scale == 'gene' and len(cats):
        lo = mean.min(axis=1, keepdims=True)
        span = mean.max(axis=1, keepdims=True) - lo
        mean = np.divide(mean - lo, span, out=np.zeros_like(mean), where=span > 0)

    row_groups = _row_groups(list(genes), gene_set_groups)
    order = np.arange(len(genes))
    if gene_ordering == 'peak_group' and len(cats):
        peaks = mean.argmax(axis=1)
        # within each contiguous group block, stable so ties keep input order
        blocks: list[list[int]] = []
        for i, g in enumerate(row_groups):
            if blocks and row_groups[blocks[-1][-1]] == g:
                blocks[-1].append(i)
            else:
                blocks.append([i])
        order = np.concatenate([np.array(b)[np.argsort(peaks[b], kind='stable')] for b in blocks]) if blocks else order

    return {
        'genes': [genes[i] for i in order],
        'row_groups': [row_groups[i] for i in order],
        'categories': cats,
        'n_cells': int(expr.shape[0]),
        'n_cells_per_category': n_per,
        'pct': pct[order].tolist(),
        'mean': mean[order].tolist(),
        'color_label': _LABELS[(color_by, standard_scale)],
        'group_ordering': group_ordering,
    }


def _cluster_columns(mean: np.ndarray) -> np.ndarray:
    """Column order from average-linkage clustering of the groups' profiles.

    Each gene is standardised across groups first so one highly expressed
    gene does not decide the whole tree; a gene flat across groups
    contributes nothing. With optimal leaf ordering, so adjacent columns are
    the most alike the tree allows.
    """
    from scipy.cluster.hierarchy import leaves_list, linkage  # noqa: PLC0415
    profiles = mean.T.astype(np.float64)  # groups × genes
    sd = profiles.std(axis=0, keepdims=True)
    z = np.divide(profiles - profiles.mean(axis=0, keepdims=True), sd,
                  out=np.zeros_like(profiles), where=sd > 0)
    if not np.any(z):
        return np.arange(profiles.shape[0])
    return np.asarray(leaves_list(linkage(z, method='average', metric='euclidean', optimal_ordering=True)))
