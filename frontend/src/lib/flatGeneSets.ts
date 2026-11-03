/** Every Gene Panel set as one flat list, in category order, with its
 *  category and folder: what the pickers in the Expression settings and the
 *  marker modal list. */
import type { GeneSet, GeneSetCategoryType } from '../store'

export const CATEGORY_ORDER: GeneSetCategoryType[] = ['manual', 'gene_clusters', 'similar_genes', 'diff_exp', 'spatial', 'marker_genes', 'line_association', 'enrichment']
export interface FlatGeneSet {
  id: string
  name: string
  genes: string[]
  genesDown?: string[]
  category: GeneSetCategoryType
  folderName?: string
}

export function getAllGeneSets(categories: Record<GeneSetCategoryType, { geneSets: GeneSet[]; folders: { name: string; geneSets: GeneSet[] }[] }>): FlatGeneSet[] {
  const all: FlatGeneSet[] = []
  for (const catType of CATEGORY_ORDER) {
    const cat = categories[catType]
    for (const gs of cat.geneSets) {
      all.push({ ...gs, category: catType })
    }
    for (const folder of cat.folders) {
      for (const gs of folder.geneSets) {
        all.push({ ...gs, category: catType, folderName: folder.name })
      }
    }
  }
  return all
}
