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
 * folder's sets keep theirs — whatever order they were clicked in. Once the
 * user drags the row blocks, `custom` (set ids) wins; a set ticked after the
 * drag follows, in list order. */
export function orderSelectedSets<T extends HeatmapSetLike>(
  all: readonly T[], picked: ReadonlySet<string>, custom: readonly string[] | null = null,
): T[] {
  const inList = all.filter((s) => picked.has(s.id))
  if (!custom) return inList
  const byId = new Map(inList.map((s) => [s.id, s]))
  const first = custom.filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  const taken = new Set(first.map((s) => s.id))
  return [...first, ...inList.filter((s) => !taken.has(s.id))]
}

/** The custom block order an applied config implies: its sets' order when
 * that differs from list order (the user dragged them), else null. */
export function restoreSetOrder(
  applied: readonly { id?: string; name: string; genes: readonly string[] }[],
  sets: readonly HeatmapSetLike[],
): string[] | null {
  const ids = [...restoreSelectedIds(applied, sets)]
  const inList = orderSelectedSets(sets, new Set(ids)).map((s) => s.id)
  return ids.every((id, i) => id === inList[i]) ? null : ids
}

/** `list` with `key` moved to `index` (clamped); unchanged when absent. */
export function moveItem(list: readonly string[], key: string, index: number): string[] {
  const from = list.indexOf(key)
  if (from < 0) return [...list]
  const rest = list.filter((_, i) => i !== from)
  const at = Math.max(0, Math.min(index, rest.length))
  return [...rest.slice(0, at), key, ...rest.slice(at)]
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
 * pick. `null` means every label in the column's order. The result keeps
 * the display `order` (the column's, unless the user dragged the list), and
 * only every label in the column's own order collapses back to null. The
 * last label cannot be unticked. Shared by the dot plot and the heatmap. */
export function toggleGroupPick(
  pick: readonly string[] | null, all: readonly string[], value: string, order: readonly string[] = all,
): string[] | null {
  const current = new Set(pick ?? all)
  if (current.has(value)) {
    if (current.size === 1) return [...current]
    current.delete(value)
  } else {
    current.add(value)
  }
  return pickInOrder([...current], order, all)
}

/** The ticked labels of `pick` (null = all) in the display `order`; null
 * when that is every label in the column's own order. */
export function pickInOrder(pick: readonly string[] | null, order: readonly string[], all: readonly string[]): string[] | null {
  const ticked = new Set(pick ?? all)
  const next = order.filter((v) => ticked.has(v))
  return next.length === all.length && next.every((v, i) => v === all[i]) ? null : next
}

/** The order the picker lists the labels in. A dragged order wins, minus
 * labels the column lost and plus new ones at the end. Without one, the
 * column's order, unless the pick is out of it (a config saved after a
 * drag): its labels first, in its order, then the rest. A pick made by
 * ticking is always in column order, so ticking never moves a row. */
export function groupDisplayOrder(dragged: readonly string[] | null, pick: readonly string[] | null, all: readonly string[]): string[] {
  const known = new Set(all)
  let head: string[] = []
  if (dragged) head = dragged.filter((v) => known.has(v))
  else if (pick) {
    const kept = pick.filter((v) => known.has(v))
    const colOrder = all.filter((v) => kept.includes(v))
    if (kept.some((v, i) => v !== colOrder[i])) head = kept
  }
  const seen = new Set(head)
  return [...head, ...all.filter((v) => !seen.has(v))]
}

/** A pick made before the column changed must not name labels it lacks;
 * while the labels are not loaded yet the pick is left alone. */
export function cleanGroupPick(pick: readonly string[] | null, all: readonly string[]): string[] | null {
  if (!pick || !all.length) return pick ? [...pick] : null
  const kept = pick.filter((g) => all.includes(g))
  return kept.length ? kept : null
}
