"""Stored marker-gene runs: the table scanpy's ranking leaves behind, and
top-X-with-filters as a read on it.

A run is a dict (JSON in ``uns['xcell_marker_genes'][key]``) whose ``table``
maps each group to column-oriented lists in scanpy score order, truncated to
``params['store_top_n']`` rows. Selecting the top N after percent-detected /
fold-change / padj filters never touches the expression matrix, so the marker
modal, the Heatmap tab and a saved figure can all re-select without re-running
the test. Pure: no AnnData here.
"""

from __future__ import annotations

import math
from collections.abc import Collection
from typing import Any

import numpy as np
import pandas as pd

RANK_BY = ('score', 'log2fc')
TABLE_COLUMNS = ('genes', 'score', 'log2fc', 'pct_in', 'pct_out', 'pval', 'pval_adj')


def _clean(values) -> list[float | None]:
    """JSON-safe floats: scanpy's log fold change is ±inf for all-zero genes."""
    out: list[float | None] = []
    for v in values:
        try:
            f = float(v)
        except (TypeError, ValueError):
            out.append(None)
            continue
        out.append(f if math.isfinite(f) else None)
    return out


def build_table(names, scores, logfoldchanges, pvals, pvals_adj, pts, pts_rest,
                groups: list[str], store_top_n: int) -> dict[str, dict[str, list]]:
    """Turn scanpy's ``rank_genes_groups`` output into the stored table.

    ``names`` … ``pvals_adj`` are indexable by group and rank (structured
    arrays or DataFrames with one column per group); ``pts`` / ``pts_rest``
    are gene-indexed DataFrames with one column per group (``pts=True``).
    """
    store_top_n = max(1, int(store_top_n))
    table: dict[str, dict[str, list]] = {}
    for g in groups:
        g = str(g)
        gene_list = [str(x) for x in list(names[g])[:store_top_n]]
        pin = pts[g].reindex(gene_list) if pts is not None and g in pts else pd.Series(np.nan, index=gene_list)
        pout = (pts_rest[g].reindex(gene_list) if pts_rest is not None and g in pts_rest
                else pd.Series(np.nan, index=gene_list))
        n = len(gene_list)
        table[g] = {
            'genes': gene_list,
            'score': _clean(list(scores[g])[:n]),
            'log2fc': _clean(list(logfoldchanges[g])[:n]),
            'pct_in': _clean(pin.to_numpy()),
            'pct_out': _clean(pout.to_numpy()),
            'pval': _clean(list(pvals[g])[:n]),
            'pval_adj': _clean(list(pvals_adj[g])[:n]),
        }
    return table


def _passes(value: float | None, lo: float | None = None, hi: float | None = None) -> bool:
    """Inclusive thresholds; a missing statistic never passes a threshold."""
    if lo is None and hi is None:
        return True
    if value is None:
        return False
    if lo is not None and value < lo:
        return False
    if hi is not None and value > hi:
        return False
    return True


def select_markers(record: dict[str, Any], *, top_n: int = 10,
                   min_pct_in: float | None = None, max_pct_out: float | None = None,
                   min_log2fc: float | None = None, max_padj: float | None = None,
                   rank_by: str = 'score', groups: list[str] | None = None,
                   genes: Collection[str] | None = None) -> dict[str, Any]:
    """Top ``top_n`` rows per group after the filters, from the stored table.

    ``genes`` restricts each group to the stored rows whose gene is in it
    (an annotation: TFs, collagens, a gene set) before the thresholds, so
    ``n_candidates`` counts the annotated genes that passed. A name outside
    the stored ranking cannot appear: the cap is the cap.

    Returns ``results`` (per group: the rows and ``n_candidates``, how many
    passed the filters before the cut), ``n_stored_per_group`` and
    ``truncated`` — whether any group holds exactly ``store_top_n`` rows, in
    which case a filter may have lost candidates the store never kept.
    """
    top_n = int(top_n)
    if top_n < 1:
        raise ValueError('top_n must be at least 1')
    if rank_by not in RANK_BY:
        raise ValueError(f"rank_by must be one of {RANK_BY}, got {rank_by!r}")
    allowed = set(genes) if genes is not None else None
    table = record.get('table') or {}
    all_groups = [str(g) for g in (record.get('groups') or list(table))]
    if groups is not None:
        unknown = [g for g in groups if g not in all_groups]
        if unknown:
            raise ValueError(f"Groups not in marker run '{record.get('key')}': {unknown}")
        chosen = [g for g in all_groups if g in set(groups)]
    else:
        chosen = all_groups
    store_top_n = int((record.get('params') or {}).get('store_top_n') or 0)

    results = []
    n_stored: dict[str, int] = {}
    truncated = False
    for g in chosen:
        cols = table.get(g) or {k: [] for k in TABLE_COLUMNS}
        n = len(cols['genes'])
        n_stored[g] = n
        if store_top_n and n >= store_top_n:
            truncated = True
        rows = [{k: cols[k][i] for k in TABLE_COLUMNS} for i in range(n)]
        if allowed is not None:
            rows = [r for r in rows if r['genes'] in allowed]
        kept = [r for r in rows
                if _passes(r['pct_in'], lo=min_pct_in)
                and _passes(r['pct_out'], hi=max_pct_out)
                and _passes(r['log2fc'], lo=min_log2fc)
                and _passes(r['pval_adj'], hi=max_padj)]
        if rank_by != 'score':
            # stable: ties keep score order; None sorts last
            kept.sort(key=lambda r: (r[rank_by] is None, -(r[rank_by] or 0.0)))
        picked = [{'gene': r['genes'], **{k: r[k] for k in TABLE_COLUMNS if k != 'genes'}} for r in kept[:top_n]]
        results.append({'group': g, 'genes': picked, 'n_candidates': len(kept)})
    return {'results': results, 'n_stored_per_group': n_stored, 'truncated': truncated,
            'restricted': allowed is not None}
