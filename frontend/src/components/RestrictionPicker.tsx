import type { CSSProperties } from 'react'
import { useStore } from '../store'
import { getAllGeneSets } from '../lib/flatGeneSets'
import { restrictionOptions, matchRestriction, type MarkerRestriction } from '../lib/markerSelection'

/** "Show only" for a marker selection: none, a Gene Panel set (its genes
 *  snapshotted), or a boolean `.var` column. A stored choice that no longer
 *  matches an option (set renamed or deleted, column gone) shows as
 *  `<label> (saved)` and is kept until something else is picked. */
export default function RestrictionPicker({ value, onChange, columns, style, title }: {
  value: MarkerRestriction | null
  onChange: (next: MarkerRestriction | null) => void
  columns: { name: string; n_true: number }[]
  style?: CSSProperties
  title?: string
}) {
  const geneSetCategories = useStore((s) => s.geneSetCategories)
  const options = restrictionOptions(getAllGeneSets(geneSetCategories), columns)
  const current = matchRestriction(options, value)
  const sets = options.filter((o) => o.group === 'Gene sets')
  const cols = options.filter((o) => o.group === '.var columns')
  return (
    <select
      value={current}
      title={title}
      style={style}
      onChange={(e) => {
        const v = e.target.value
        if (v === '') onChange(null)
        else if (v !== 'saved') onChange(options.find((o) => o.value === v)!.restriction)
      }}
    >
      <option value="">None</option>
      {current === 'saved' && value && <option value="saved">{value.label} (saved)</option>}
      {sets.length > 0 && (
        <optgroup label="Gene sets">
          {sets.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      )}
      {cols.length > 0 && (
        <optgroup label=".var columns">
          {cols.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      )}
    </select>
  )
}
