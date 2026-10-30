import { describe, it, expect } from 'vitest'
import {
  parseGeneInput,
  geneQuery,
  isHit,
  computeLoadingHits,
  orderPcs,
  formatHitCount,
  geneSetInputText,
} from './pcaLoadingHits'

const g = (...names: string[]) => names.map((gene, i) => ({ gene, loading: 1 - i * 0.1 }))

// Four PCs, top-3 per side, as the loadings endpoint returns them.
const PCS = [
  { index: 0, positive: g('Sox2', 'Pou5f1', 'Nanog'), negative: g('Hba-a1', 'Hbb-y', 'Gata1') },
  { index: 1, positive: g('T', 'Mixl1', 'Eomes'), negative: g('Sox2', 'Otx2', 'Utf1') },
  { index: 2, positive: g('Foxa2', 'Sox17', 'Cer1'), negative: g('Krt18', 'Krt8', 'Cdx2') },
  { index: 3, positive: g('Hand1', 'Msx2', 'Bmp4'), negative: g('Nanog', 'Pou5f1', 'Otx2') },
]

describe('parseGeneInput', () => {
  it('splits on commas, semicolons, spaces, tabs and newlines and trims', () => {
    expect(parseGeneInput(' Sox2,Pou5f1 ; Nanog\nT\tMixl1  ')).toEqual(['Sox2', 'Pou5f1', 'Nanog', 'T', 'Mixl1'])
  })

  it('drops empty tokens', () => {
    expect(parseGeneInput(',, ;\n')).toEqual([])
    expect(parseGeneInput('')).toEqual([])
  })

  it('dedupes case-insensitively, keeping the first spelling', () => {
    expect(parseGeneInput('Sox2, SOX2, sox2, Nanog, Sox2')).toEqual(['Sox2', 'Nanog'])
  })
})

describe('isHit', () => {
  it('matches regardless of case', () => {
    const q = geneQuery(['SOX2', 'nanog'])
    expect(isHit(q, 'Sox2')).toBe(true)
    expect(isHit(q, 'NANOG')).toBe(true)
    expect(isHit(q, 'Sox17')).toBe(false)
  })

  it('does not match on a prefix', () => {
    expect(isHit(geneQuery(['Sox1']), 'Sox17')).toBe(false)
  })
})

describe('computeLoadingHits', () => {
  it('counts positive and negative matches per PC, keyed by 1-based PC number', () => {
    const r = computeLoadingHits(PCS, ['sox2', 'NANOG', 'Otx2'])
    expect(r.byPc.get(1)).toEqual({ pos: 2, neg: 0, total: 2 })
    expect(r.byPc.get(2)).toEqual({ pos: 0, neg: 2, total: 2 })
    expect(r.byPc.get(3)).toEqual({ pos: 0, neg: 0, total: 0 })
    expect(r.byPc.get(4)).toEqual({ pos: 0, neg: 2, total: 2 })
  })

  it('summarises genes found, genes not found (in input order and spelling) and PCs with hits', () => {
    const r = computeLoadingHits(PCS, ['Sox2', 'Zfp42', 'cdx2', 'Dppa3'])
    expect(r.nGenes).toBe(4)
    expect(r.found).toEqual(['Sox2', 'cdx2'])
    expect(r.notFound).toEqual(['Zfp42', 'Dppa3'])
    expect(r.nPcsWithHits).toBe(3) // PC1 (+Sox2), PC2 (−Sox2), PC3 (−Cdx2)
  })

  it('a gene in several PCs counts once in the summary but in every PC', () => {
    const r = computeLoadingHits(PCS, ['Pou5f1'])
    expect(r.found).toEqual(['Pou5f1'])
    expect(r.byPc.get(1)!.total).toBe(1)
    expect(r.byPc.get(4)!.total).toBe(1)
    expect(r.nPcsWithHits).toBe(2)
  })

  it('an empty gene list has no hits anywhere', () => {
    const r = computeLoadingHits(PCS, [])
    expect(r.nGenes).toBe(0)
    expect(r.nPcsWithHits).toBe(0)
    expect([...r.byPc.values()].every((h) => h.total === 0)).toBe(true)
  })
})

describe('orderPcs', () => {
  const pcNums = (pcs: { index: number }[]) => pcs.map((p) => p.index + 1)

  it('PC order leaves the list as given', () => {
    const r = computeLoadingHits(PCS, ['Otx2', 'Nanog', 'Pou5f1', 'Hand1'])
    expect(pcNums(orderPcs(PCS, r.byPc, 'pc'))).toEqual([1, 2, 3, 4])
  })

  it('hits order sorts by total desc, ties by PC number, zero-hit PCs after in PC order', () => {
    // PC1: Nanog, Pou5f1 = 2; PC2: Otx2 = 1; PC3: 0; PC4: Hand1, Nanog, Pou5f1, Otx2 = 4
    const r = computeLoadingHits(PCS, ['Otx2', 'Nanog', 'Pou5f1', 'Hand1'])
    expect(pcNums(orderPcs(PCS, r.byPc, 'hits'))).toEqual([4, 1, 2, 3])
  })

  it('breaks ties by PC number, not by input position', () => {
    const shuffled = [PCS[3], PCS[2], PCS[1], PCS[0]]
    // PC1 and PC4 both hold Nanog and Pou5f1; PC2 and PC3 have none.
    const r = computeLoadingHits(PCS, ['Nanog', 'Pou5f1'])
    expect(pcNums(orderPcs(shuffled, r.byPc, 'hits'))).toEqual([1, 4, 2, 3])
  })

  it('does not mutate its input', () => {
    const input = [...PCS]
    orderPcs(input, computeLoadingHits(PCS, ['Hand1']).byPc, 'hits')
    expect(pcNums(input)).toEqual([1, 2, 3, 4])
  })
})

describe('formatHitCount', () => {
  it('shows total with the +/− split', () => {
    expect(formatHitCount({ pos: 2, neg: 1, total: 3 })).toBe('3 (2+/1−)')
    expect(formatHitCount({ pos: 0, neg: 0, total: 0 })).toBe('0')
  })
})

describe('geneSetInputText', () => {
  it('joins up and down genes of a set, deduped', () => {
    expect(geneSetInputText({ genes: ['Sox2', 'Nanog'], genesDown: ['Hand1', 'sox2'] })).toBe('Sox2, Nanog, Hand1')
    expect(geneSetInputText({ genes: ['T'] })).toBe('T')
  })
})
