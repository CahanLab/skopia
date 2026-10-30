/** Pure helpers for the .obs manager: the table's sort, filter and
 *  checkbox selection (including shift-click ranges), and the client-side
 *  name check. The modal owns no logic it could get wrong silently. */

export type ObsKind = 'categorical' | 'boolean' | 'integer' | 'float' | 'string' | 'other'
export const OBS_KINDS: ObsKind[] = ['categorical', 'boolean', 'integer', 'float', 'string', 'other']

export type ObsConvertTarget = 'categorical' | 'string' | 'numeric' | 'boolean'

export interface ObsColumnInfo {
  name: string
  dtype: string
  kind: ObsKind
  n_unique: number | null
  n_missing: number
  preview: { top: { value: string; count: number }[] } | { min: number | null; median: number | null; max: number | null }
  has_colors: boolean
  subset: string | null
  prefix_group: string | null
}

export type ObsSortKey = 'order' | 'name' | 'kind' | 'n_unique' | 'n_missing'
export interface ObsSort { key: ObsSortKey; dir: 'asc' | 'desc' }

/** Sort a copy. 'order' is the .obs order the backend returned; ties on any
 *  other key fall back to it, so the table never shuffles between renders.
 *  A null unique count (unhashable values) sorts last either way. */
export function sortColumns(cols: readonly ObsColumnInfo[], sort: ObsSort): ObsColumnInfo[] {
  const indexed = cols.map((c, i) => ({ c, i }))
  const sign = sort.dir === 'asc' ? 1 : -1
  const cmp = (a: { c: ObsColumnInfo; i: number }, b: { c: ObsColumnInfo; i: number }): number => {
    switch (sort.key) {
      case 'name': {
        const d = a.c.name.localeCompare(b.c.name, undefined, { numeric: true, sensitivity: 'base' })
        if (d) return sign * d
        break
      }
      case 'kind': {
        const d = OBS_KINDS.indexOf(a.c.kind) - OBS_KINDS.indexOf(b.c.kind)
        if (d) return sign * d
        break
      }
      case 'n_unique': {
        const x = a.c.n_unique, y = b.c.n_unique
        if (x === null && y !== null) return 1
        if (y === null && x !== null) return -1
        if (x !== null && y !== null && x !== y) return sign * (x - y)
        break
      }
      case 'n_missing': {
        if (a.c.n_missing !== b.c.n_missing) return sign * (a.c.n_missing - b.c.n_missing)
        break
      }
      case 'order':
        return sign * (a.i - b.i)
    }
    return a.i - b.i
  }
  return indexed.sort(cmp).map((x) => x.c)
}

/** Columns whose name contains the query (case-insensitive) and whose kind is
 *  in `kinds`. An empty `kinds` set means no kind filter. */
export function filterColumns(
  cols: readonly ObsColumnInfo[], query: string, kinds: ReadonlySet<ObsKind>,
): ObsColumnInfo[] {
  const q = query.trim().toLowerCase()
  return cols.filter((c) =>
    (kinds.size === 0 || kinds.has(c.kind)) && (!q || c.name.toLowerCase().includes(q)))
}

export function countByKind(cols: readonly ObsColumnInfo[]): Record<ObsKind, number> {
  const out = Object.fromEntries(OBS_KINDS.map((k) => [k, 0])) as Record<ObsKind, number>
  for (const c of cols) out[c.kind] += 1
  return out
}

/** A checkbox click. Plain: toggle `name` and make it the anchor. Shift with
 *  an anchor still visible: give every row from anchor to `name` (in the
 *  order shown) the state the clicked row is moving to; the anchor stays. */
export function clickSelection(
  selected: ReadonlySet<string>,
  name: string,
  opts: { shift: boolean; anchor: string | null; visible: readonly string[] },
): { selected: Set<string>; anchor: string | null } {
  const next = new Set(selected)
  const turnOn = !selected.has(name)
  const a = opts.anchor === null ? -1 : opts.visible.indexOf(opts.anchor)
  const b = opts.visible.indexOf(name)
  if (opts.shift && a >= 0 && b >= 0) {
    const [lo, hi] = a < b ? [a, b] : [b, a]
    for (let i = lo; i <= hi; i++) {
      if (turnOn) next.add(opts.visible[i])
      else next.delete(opts.visible[i])
    }
    return { selected: next, anchor: opts.anchor }
  }
  if (turnOn) next.add(name)
  else next.delete(name)
  return { selected: next, anchor: name }
}

export type TickState = 'none' | 'some' | 'all'

export function visibleTickState(selected: ReadonlySet<string>, visible: readonly string[]): TickState {
  if (visible.length === 0) return 'none'
  const n = visible.filter((v) => selected.has(v)).length
  return n === 0 ? 'none' : n === visible.length ? 'all' : 'some'
}

/** The header checkbox: select every visible row, or clear them all when they
 *  already are. Selected rows hidden by the filter are left alone. */
export function toggleAllVisible(selected: ReadonlySet<string>, visible: readonly string[]): Set<string> {
  const next = new Set(selected)
  if (visibleTickState(selected, visible) === 'all') visible.forEach((v) => next.delete(v))
  else visible.forEach((v) => next.add(v))
  return next
}

/** Keep only names that still exist, after a delete or a refetch. */
export function pruneSelection(selected: ReadonlySet<string>, names: readonly string[]): Set<string> {
  const have = new Set(names)
  return new Set([...selected].filter((s) => have.has(s)))
}

/** Why a new column name cannot be used, or null. The backend checks too;
 *  this only saves a round trip and keeps the button honest. */
export function newNameProblem(name: string, existing: readonly string[]): string | null {
  const n = name.trim()
  if (!n) return 'Enter a name.'
  if (existing.includes(n)) return `A column named '${n}' already exists.`
  return null
}

/** Conversions worth offering for a column. Numeric may still be refused by
 *  the backend (a value that does not parse); boolean is offered only for
 *  columns with at most two values and none missing. A saved subset's
 *  column offers none: it must stay boolean. */
export function convertTargets(col: ObsColumnInfo): ObsConvertTarget[] {
  if (col.subset) return []
  const out: ObsConvertTarget[] = []
  if (col.kind !== 'categorical') out.push('categorical')
  if (col.kind !== 'string') out.push('string')
  if (col.kind !== 'integer' && col.kind !== 'float') out.push('numeric')
  if (col.kind !== 'boolean' && col.n_unique !== null && col.n_unique <= 2 && col.n_missing === 0) {
    out.push('boolean')
  }
  return out
}

const TRUE_WORDS = ['true', 'yes', '1', '1.0', 't', 'y']

/** The value a boolean conversion should treat as True by default: a
 *  recognisable word if present, else the first value listed. */
export function defaultTrueValue(values: readonly string[]): string | null {
  const hit = values.find((v) => TRUE_WORDS.includes(v.toLowerCase()))
  return hit ?? values[0] ?? null
}

function fmtNum(x: number | null): string {
  if (x === null) return '–'
  if (Number.isInteger(x)) return x.toLocaleString()
  const a = Math.abs(x)
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return x.toExponential(2)
  // toPrecision(3) would print 12435.5 as 1.24e+4
  if (a >= 100) return x.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return x.toPrecision(3)
}

/** One line for the preview cell. */
export function formatPreview(col: ObsColumnInfo): string {
  const p = col.preview
  if ('top' in p) {
    if (p.top.length === 0) return ''
    const shown = p.top.map((t) => `${t.value} (${t.count.toLocaleString()})`).join(', ')
    const more = col.n_unique !== null && col.n_unique > p.top.length ? ', …' : ''
    return shown + more
  }
  if (p.min === null) return 'no values'
  return `${fmtNum(p.min)} · ${fmtNum(p.median)} · ${fmtNum(p.max)}`
}
