/** Exclude Genes by type: the selection, the preset and the request body.
 *
 * The backend builds one exclusion mask from names, patterns and types for
 * the preview, the removal and the mark (`_exclusion_mask` in adaptor.py);
 * these rules only decide what the modal sends. */

export interface GeneTypeCount {
  name: string
  n: number
  examples: string[]
}

export interface GeneTypeSetCount extends GeneTypeCount {
  description: string
  /** 'file' when read from the file's own boolean column, 'skopia' when computed */
  computed_by: 'file' | 'skopia'
}

export interface GeneTypeSelectionSummary {
  n_removed: number
  n_kept: number
  examples: string[]
  n_added_by_names_patterns: number
  added_examples: string[]
}

export interface GeneTypeSummary {
  species: string | null
  available_species: string[]
  source: { kind: 'gencode' | 'file'; label: string; species: string | null } | null
  n_genes: number
  matched: { ensembl_id: number; symbol: number; file: number; unmatched: number } | null
  classes: GeneTypeCount[]
  sets: GeneTypeSetCount[]
  selection: GeneTypeSelectionSummary | null
}

export interface GeneTypeSelection {
  classes: string[]
  sets: string[]
  species: string | null
}

export const EMPTY_SELECTION: GeneTypeSelection = { classes: [], sets: [], species: null }

/** Classes *Protein-coding only* leaves alone: the coding genes themselves,
 * and the genes no annotation knows (reporters, transgenes, cryten's
 * `exogenous`), which are not among the types the preset names. */
const KEEP_CLASSES = new Set(['protein_coding', 'unannotated', 'exogenous'])
const PRESET_SETS = ['mt', 'ribo', 'predicted']

export function proteinCodingOnly(summary: GeneTypeSummary): GeneTypeSelection {
  const offered = new Set(summary.sets.map((s) => s.name))
  return {
    classes: summary.classes.map((c) => c.name).filter((c) => !KEEP_CLASSES.has(c)),
    sets: PRESET_SETS.filter((s) => offered.has(s)),
    species: summary.species,
  }
}

export function selectionIsEmpty(sel: GeneTypeSelection): boolean {
  return sel.classes.length === 0 && sel.sets.length === 0
}

export type ExcludeGenesBody = {
  gene_names: string[] | null
  patterns: string[] | null
  types: GeneTypeSelection | null
}

/** The body for exclude_genes, its summary and the mark: names one per line,
 * patterns comma-separated, blanks dropped (the modal's parse since before
 * types), and `types: null` for an empty selection. */
export function excludeGenesBody(
  namesText: string,
  patternsText: string,
  sel: GeneTypeSelection,
): ExcludeGenesBody | { error: string } {
  const names = String(namesText ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean)
  const patterns = String(patternsText ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const types = selectionIsEmpty(sel) ? null : sel
  if (names.length === 0 && patterns.length === 0 && types == null) {
    return { error: 'Provide gene names, a regex pattern or a gene type.' }
  }
  return {
    gene_names: names.length ? names : null,
    patterns: patterns.length ? patterns : null,
    types,
  }
}

const fmt = (n: number) => n.toLocaleString('en-US')

export function summaryLine(selection: GeneTypeSelectionSummary): string {
  const noun = selection.n_removed === 1 ? 'gene' : 'genes'
  let line = `Removes ${fmt(selection.n_removed)} ${noun}, keeps ${fmt(selection.n_kept)}.`
  const added = selection.n_added_by_names_patterns
  if (added > 0) {
    const more = added > selection.added_examples.length ? ', ...' : ''
    line += ` Names and patterns add ${fmt(added)} beyond the types (${selection.added_examples.join(', ')}${more}).`
  }
  return line
}

export function mitoWarning(sel: GeneTypeSelection): string | null {
  return sel.sets.includes('mt')
    ? 'Removing mitochondrial genes before Filter Cells means its % mito threshold can no longer be used.'
    : null
}
