/**
 * Ordering and naming of the heatmap's gene-set groups.
 *
 * Gene sets nest as folder → set, and a pathway bundle uses that: the folder
 * is the pathway, the sets are its roles in a fixed order (ligands, receptors,
 * modulators, effectors, inhibitors, targets). A heatmap of a pathway should
 * therefore show its sets in the folder's own order, not the order they were
 * clicked; and when sets from several folders are mixed, a group has to say
 * which folder it came from — every pathway has a "ligands" set.
 */

export interface HeatmapSetLike {
  id: string
  name: string
  genes: string[]
  folderName?: string
}

/** The picked sets in list order — folders keep their order, and each
 * folder's sets keep theirs — whatever order they were clicked in. */
export function orderSelectedSets<T extends HeatmapSetLike>(all: readonly T[], picked: ReadonlySet<string>): T[] {
  return all.filter((s) => picked.has(s.id))
}

/** The row-group label for one picked set: the set's own name when every
 * picked set shares a folder (or has none); "Folder · name" once folders
 * are mixed, so equal role names stay apart in the colour bar and legend. */
export function groupLabel(set: HeatmapSetLike, picked: readonly HeatmapSetLike[]): string {
  const folders = new Set(picked.map((s) => s.folderName ?? ''))
  if (folders.size <= 1 || !set.folderName) return set.name
  return `${set.folderName} · ${set.name}`
}

/** Which sets an applied config selected. By id when the config carries
 * ids; otherwise (a config saved before ids were kept) by name and gene
 * count — and not at all when several sets share that name, since every
 * pathway folder has a "ligands", and guessing would tick the wrong one. */
export function restoreSelectedIds(
  applied: readonly { id?: string; name: string; genes: readonly string[] }[],
  sets: readonly HeatmapSetLike[],
): Set<string> {
  const byId = new Set(sets.map((s) => s.id))
  const out = new Set<string>()
  for (const a of applied) {
    if (a.id && byId.has(a.id)) { out.add(a.id); continue }
    if (a.id) continue
    const matches = sets.filter((s) => s.name === a.name && s.genes.length === a.genes.length)
    if (matches.length === 1) out.add(matches[0].id)
  }
  return out
}

export type FolderSelection = 'none' | 'some' | 'all'

export function folderSelectionState(
  all: readonly HeatmapSetLike[], folderName: string, picked: ReadonlySet<string>,
): FolderSelection {
  const ids = all.filter((s) => s.folderName === folderName).map((s) => s.id)
  const n = ids.filter((id) => picked.has(id)).length
  if (n === 0) return 'none'
  return n === ids.length ? 'all' : 'some'
}

/** Tick or untick one label of a grouping column in a "groups to show"
 * pick. `null` means every label; the result keeps the column's order, and
 * a pick that is every label again collapses back to null. The last label
 * cannot be unticked. Shared by the dot plot and the heatmap. */
export function toggleGroupPick(pick: readonly string[] | null, all: readonly string[], value: string): string[] | null {
  const current = new Set(pick ?? all)
  if (current.has(value)) {
    if (current.size === 1) return [...current]
    current.delete(value)
  } else {
    current.add(value)
  }
  const next = all.filter((v) => current.has(v))
  return next.length === all.length ? null : next
}

/** A pick made before the column changed must not name labels it lacks;
 * while the labels are not loaded yet the pick is left alone. */
export function cleanGroupPick(pick: readonly string[] | null, all: readonly string[]): string[] | null {
  if (!pick || !all.length) return pick ? [...pick] : null
  const kept = pick.filter((g) => all.includes(g))
  return kept.length ? kept : null
}
