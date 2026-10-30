// Gene-set hits in the PCA Loadings table: which of a user's genes sit in each
// PC's displayed top-N positive / negative lists. Computed over what the table
// already shows, so a gene that loads just below top-N is "not found", not
// absent from the PC.
//
// Matching is case-insensitive on symbols: a human-cased set (SOX2) pasted
// against a mouse dataset (Sox2) should still hit.

export type PcOrder = 'pc' | 'hits'

export interface PcHitCount {
  pos: number
  neg: number
  total: number
}

interface LoadingPcLike {
  index: number // zero-based, as the loadings endpoint returns it
  positive: { gene: string }[]
  negative: { gene: string }[]
}

export interface LoadingHits {
  query: Set<string>
  /** Keyed by 1-based PC number, the same key the checked-PC set uses. */
  byPc: Map<number, PcHitCount>
  nGenes: number
  /** Input genes present in at least one displayed list, in input spelling. */
  found: string[]
  notFound: string[]
  nPcsWithHits: number
}

/** Split on commas, semicolons and whitespace; trim; dedupe ignoring case. */
export function parseGeneInput(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const tok of text.split(/[\s,;]+/)) {
    const t = tok.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

export function geneQuery(genes: string[]): Set<string> {
  return new Set(genes.map((g) => g.toLowerCase()))
}

export function isHit(query: Set<string>, gene: string): boolean {
  return query.size > 0 && query.has(gene.toLowerCase())
}

export function computeLoadingHits(pcs: LoadingPcLike[], genes: string[]): LoadingHits {
  const query = geneQuery(genes)
  const byPc = new Map<number, PcHitCount>()
  const present = new Set<string>()
  let nPcsWithHits = 0
  for (const pc of pcs) {
    let pos = 0
    let neg = 0
    for (const { gene } of pc.positive) {
      if (isHit(query, gene)) { pos += 1; present.add(gene.toLowerCase()) }
    }
    for (const { gene } of pc.negative) {
      if (isHit(query, gene)) { neg += 1; present.add(gene.toLowerCase()) }
    }
    const total = pos + neg
    if (total > 0) nPcsWithHits += 1
    byPc.set(pc.index + 1, { pos, neg, total })
  }
  const found: string[] = []
  const notFound: string[] = []
  for (const g of genes) (present.has(g.toLowerCase()) ? found : notFound).push(g)
  return { query, byPc, nGenes: genes.length, found, notFound, nPcsWithHits }
}

/** 'pc': PC number. 'hits': total hits desc, ties and zero-hit PCs by PC number. */
export function orderPcs<T extends { index: number }>(
  pcs: T[],
  byPc: Map<number, PcHitCount>,
  order: PcOrder,
): T[] {
  const sorted = [...pcs]
  if (order === 'pc') return sorted
  const total = (p: T) => byPc.get(p.index + 1)?.total ?? 0
  return sorted.sort((a, b) => total(b) - total(a) || a.index - b.index)
}

export function formatHitCount(h: PcHitCount): string {
  return h.total === 0 ? '0' : `${h.total} (${h.pos}+/${h.neg}−)`
}

/** The text a "From gene set…" pick puts in the field: up and down genes. */
export function geneSetInputText(set: { genes: string[]; genesDown?: string[] }): string {
  return parseGeneInput([...set.genes, ...(set.genesDown ?? [])].join(',')).join(', ')
}
