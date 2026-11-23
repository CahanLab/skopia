/** A .var column name from a gene set's name: letters, digits and single
 * underscores, so it reads as an identifier in scanpy code and in the
 * gene-subset pickers. Never empty, never leading with a digit. */
export function suggestVarColumnName(setName: string): string {
  const base = setName.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  if (!base) return 'gene_set'
  return /^[0-9]/.test(base) ? `set_${base}` : base
}
