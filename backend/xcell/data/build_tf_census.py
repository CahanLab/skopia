"""Build the transcription-factor census bundles.

Run this to regenerate ``gene_sets/tf_census_{human,mouse}.json`` beside it
from the tables under ``tf_census/``. Edit the tables (or ``DROPPED``), run
the build, never the JSON; ``test_tf_census_bundles.py`` fails when the
shipped JSON is not what the build produces.

Human: ``human_codebook_table14.tsv`` is Supplementary Table 14 of Jolma et
al. 2026 (Codebook, Nature, doi 10.1038/s41586-026-10798-9), the 1,639
Lambert 2018 TFs with Codebook's ``TF re-assessment``. Rows re-assessed as
unlikely to be sequence-specific TFs (83) are left out; 1,556 remain. The
table keeps Lambert-era symbols (ARNTL, T, HKR1 ...), so a symbol the
bundled Ensembl table does not know is resolved through its Ensembl ID
instead (BMAL1, TBXT, ZNF875); what still resolves to nothing must be named
in ``DROPPED`` or the build refuses.

Mouse: ``mouse_tfs.tsv`` was built on 2026-11-03 (see
``docs/measurements/2026-11-03-tf-annotation-sources.md``): MGI orthologs
of the human census (1,339), plus CIS-BP 3.10 mouse TFs with no human
ortholog (120), plus 17 CIS-BP-only genes whose human ortholog was never
assessed, kept and tagged for review. 1,476 rows.

Each bundle holds one ``All TFs (<species>)`` set and folders that split it:
by DNA-binding domain (a gene with two domains is in both sets; families
under ``MIN_FAMILY`` genes are pooled), by motif evidence (human) and by
provenance (mouse). Sets are sorted alphabetically.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
TABLE_DIR = HERE / 'tf_census'
OUT_DIR = HERE / 'gene_sets'

#: Codebook's ``TF re-assessment`` value for rows that leave the census.
UNLIKELY = 'Unlikely to be sequence specific TF'
#: A DBD family with fewer genes than this is pooled into ``OTHER_FAMILIES``;
#: a one-gene set clutters the picker without saying anything.
MIN_FAMILY = 5
OTHER_FAMILIES = 'Other DBD families'

#: Symbols the build leaves out, with the reason. Anything else that the
#: bundled Ensembl table does not know is a build failure.
DROPPED: dict[str, dict[str, str]] = {
    'human': {
        'DUX1': 'no Ensembl gene (DUX1_HUMAN, a UniProt-only entry from the D4Z4 array)',
        'DUX3': 'no Ensembl gene (DUX3_HUMAN, as DUX1)',
        'AC138696.1': 'ENSG00000264668 has no symbol in the bundled Ensembl table',
        'AC008770': 'ENSG00000267179 has no symbol in the bundled Ensembl table',
    },
    'mouse': {
        'Chchd2l2': 'absent from the shipped GENCODE table; an MGI class-key ortholog of ZBED5, doubtful',
        'Gm14430': 'absent from the shipped GENCODE table (KZFP on an unplaced scaffold)',
        'Zfp1002': 'absent from the shipped GENCODE table (KZFP on an unplaced scaffold)',
    },
}

EVIDENCE_SETS = {
    'Known motif': 'Known motif',
    'Inferred motif': 'Inferred motif',
    'Likely to be sequence specific TF': 'Likely TF, no motif',
}
PROVENANCE_SETS = {
    'human_census_ortholog': 'Human census ortholog',
    'cisbp_3.10;human_census_ortholog': 'Human census ortholog',
    'cisbp_3.10_only_mouse_specific': 'Mouse-specific (CIS-BP)',
    'cisbp_3.10_only_human_ortholog_unassessed': 'Ortholog unassessed (review)',
}

DESCRIPTION = {
    'human': (
        'The 1,556 human transcription factors of the Codebook update (Jolma et al. 2026, Nature, '
        'Supplementary Table 14) to the Lambert 2018 census: the 1,639 Lambert TFs minus the 83 Codebook '
        're-assessed as unlikely to be sequence-specific; 4 more with no Ensembl gene or symbol are left out. '
        'Lambert-era symbols are updated through their Ensembl IDs (ARNTL is BMAL1, T is TBXT). '
        'All TFs is the census; the folders split it by DNA-binding domain (a gene with two domains is in '
        'both) and by motif evidence (known motif 1,317; inferred 104; likely TF with no motif 135).'
    ),
    'mouse': (
        'A mouse transcription-factor list built on 2026-11-03, since no curated mouse census exists: '
        'MGI orthologs of the 1,556-TF human Codebook census (1,339 genes), plus CIS-BP 3.10 mouse TFs with no '
        'human ortholog (120: Rhox, Obox, Duxbl, mouse Zfp expansions), plus 17 CIS-BP-only genes whose human '
        'ortholog was never assessed, kept for review; 3 absent from the shipped GENCODE table are left out. '
        'All TFs is the list; the folders split it by DNA-binding domain (a gene with two domains is in both) '
        'and by provenance. Known gap: the mouse KRAB-Zfp expansion is only partly covered.'
    ),
}


def read_rows(species: str) -> list[dict[str, str]]:
    """The species table as rows of ``symbol``, ``dbd`` and, for human,
    ``ensembl_id`` and ``evidence``; for mouse, ``source``."""
    if species == 'human':
        with open(TABLE_DIR / 'human_codebook_table14.tsv', newline='') as fh:
            return [{
                'symbol': r['TF (HGNC)'], 'ensembl_id': r['TF (Ensembl ID)'],
                'dbd': r['TF DBD(s) (Codebook, Jolma 2026)'], 'evidence': r['TF re-assessment'],
            } for r in csv.DictReader(fh, delimiter='\t')]
    if species == 'mouse':
        with open(TABLE_DIR / 'mouse_tfs.tsv', newline='') as fh:
            return [{'symbol': r['mouse_symbol'], 'dbd': r['dbd'], 'source': r['source']}
                    for r in csv.DictReader(fh, delimiter='\t')]
    raise ValueError(f'no TF table for {species!r}')


def _families(dbd: str) -> list[str]:
    out = []
    for part in dbd.split(';'):
        fam = part.strip()
        if fam and fam not in out:
            out.append(fam)
    return out or ['Unknown']


def _resolve(species: str, rows: list[dict[str, str]], table: dict[str, str]
             ) -> tuple[list[dict[str, str]], list[str]]:
    """Rows that enter the bundle, each with its current symbol, and the
    problems that stop the build."""
    known = set(table.values())
    dropped = DROPPED.get(species, {})
    kept: list[dict[str, str]] = []
    problems: list[str] = []
    for r in rows:
        if r.get('evidence') == UNLIKELY:
            continue
        sym = r['symbol']
        if sym in dropped:
            continue
        if sym not in known:
            gid = r.get('ensembl_id', '')
            current = table.get(gid)
            if current and current != gid:
                sym = current
            else:
                problems.append(f'{species}: {sym} ({gid or "no Ensembl ID"}) is not in the Ensembl table')
                continue
        kept.append({**r, 'symbol': sym})
    seen = [g['symbol'] for g in kept]
    for dup in sorted({s for s in seen if seen.count(s) > 1}):
        problems.append(f'{species}: {dup} appears more than once')
    return kept, problems


def problems(species: str, rows: list[dict[str, str]], table: dict[str, str]) -> list[str]:
    return _resolve(species, rows, table)[1]


def _set(name: str, genes: list[str], folder: str | None = None) -> dict:
    out = {'name': name, 'genes': sorted(set(genes))}
    if folder:
        out['folder'] = folder
    return out


def build(species: str, rows: list[dict[str, str]], table: dict[str, str]) -> dict:
    kept, bad = _resolve(species, rows, table)
    if bad:
        raise ValueError('\n'.join(bad))
    sets = [_set(f'All TFs ({species})', [g['symbol'] for g in kept])]

    by_family: dict[str, list[str]] = {}
    for g in kept:
        for fam in _families(g['dbd']):
            by_family.setdefault(fam, []).append(g['symbol'])
    folder = f'TFs by DNA-binding domain ({species})'
    other: list[str] = []
    for fam in sorted(by_family, key=lambda f: (-len(by_family[f]), f)):
        if len(by_family[fam]) >= MIN_FAMILY:
            sets.append(_set('Unknown DBD' if fam == 'Unknown' else fam, by_family[fam], folder))
        else:
            other += by_family[fam]
    if other:
        sets.append(_set(OTHER_FAMILIES, other, folder))

    if species == 'human':
        folder = 'TFs by motif evidence (human)'
        for value, name in EVIDENCE_SETS.items():
            genes = [g['symbol'] for g in kept if g['evidence'] == value]
            if genes:
                sets.append(_set(name, genes, folder))
    else:
        folder = 'TFs by provenance (mouse)'
        for name in dict.fromkeys(PROVENANCE_SETS.values()):
            genes = [g['symbol'] for g in kept if PROVENANCE_SETS.get(g['source']) == name]
            if genes:
                sets.append(_set(name, genes, folder))

    return {'name': f'Transcription factors ({species})', 'description': DESCRIPTION[species], 'sets': sets}


def main() -> int:
    sys.path.insert(0, str(HERE.parent.parent))
    from xcell import gene_symbols
    bundles = {}
    for sp in ('human', 'mouse'):
        rows, table = read_rows(sp), gene_symbols.load_table(sp)
        bad = problems(sp, rows, table)
        if bad:
            print('\n'.join(bad))
            return 1
        bundles[sp] = build(sp, rows, table)
    OUT_DIR.mkdir(exist_ok=True)
    for sp, bundle in bundles.items():
        path = OUT_DIR / f'tf_census_{sp}.json'
        path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + '\n')
        n_all = len(bundle['sets'][0]['genes'])
        print(f'wrote {path.name}: {len(bundle["sets"])} sets, {n_all} TFs')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
