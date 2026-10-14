/** Species-aware preset for Analyze → Preprocess → Exclude Genes.
 *
 * The stock default is the mouse list. When the dataset's gene names say
 * human, the preset switches to the human spellings plus two human-only
 * nuisances: bare Ensembl IDs left in a symbol index and LINC RNAs. */

export const EXCLUDE_GENE_PATTERNS: Readonly<Record<string, string>> = {
  mouse: '^mt-, ^Gm\\d+, ^Rps, ^Rpl',
  human: '^MT-, ^ENS, ^RPS, ^RPL, ^LINC',
}

export const DEFAULT_EXCLUDE_GENE_PATTERNS = EXCLUDE_GENE_PATTERNS.mouse

/** The patterns to put in the field for `species`, or null to leave it alone:
 * the species is unknown or has no preset, or the field no longer holds the
 * stock default (a user-config override or an edit must win). */
export function excludeGenePatternsFor(species: string | null | undefined, current: unknown): string | null {
  if (!species) return null
  const preset = EXCLUDE_GENE_PATTERNS[species]
  if (!preset || preset === current) return null
  return current === DEFAULT_EXCLUDE_GENE_PATTERNS ? preset : null
}
