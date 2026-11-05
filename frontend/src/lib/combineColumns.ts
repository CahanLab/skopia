/**
 * Column-policy bookkeeping for File → Combine datasets.
 *
 * Each .obs / .var column across the inputs gets one of a few outcomes, and
 * the backend rejects a policy naming a column no dataset has — so the seed
 * has to be re-derived whenever the file list changes, not merged blindly.
 *
 * A .obs column can also be declared the same as another (`same:<target>`):
 * the same labels under two names, pooled into the target's column. On the
 * wire that is `obs_merge_into`, not a policy value; `splitObsPolicy` makes
 * the request.
 */

export type ObsPolicy = 'merge' | 'separate' | 'drop'
export type VarPolicy = 'first' | 'separate' | 'drop'
export type Policy = ObsPolicy | VarPolicy

export const SAME_PREFIX = 'same:'

export interface SameAsCandidate { name: string; shared: number; union: number }

export interface ColumnInfo {
  name: string
  datasets: string[]
  kind: string
  suggested: Policy
  reason: string
  identical?: boolean
  n_unique?: number | null
  /** Label overlap across the datasets holding it; null for measurements. */
  labels?: { shared: number; union: number } | null
  /** Other columns this one could be pooled with, best first. */
  same_as?: SameAsCandidate[]
}

export function sameTarget(value: string | undefined): string | null {
  if (!value || !value.startsWith(SAME_PREFIX)) return null
  return value.slice(SAME_PREFIX.length)
}

/**
 * Every offered column mapped to a policy: the user's choice where they made
 * one, the backend's suggestion otherwise. Choices for columns that are no
 * longer offered are dropped, since sending one is an error — and so is a
 * `same:` whose target is no longer offered.
 */
export function seedPolicy(
  columns: ColumnInfo[],
  existing: Record<string, string> = {},
): Record<string, string> {
  const offered = new Set(columns.map((c) => c.name))
  const out: Record<string, string> = {}
  for (const col of columns) {
    const chosen = existing[col.name]
    const target = sameTarget(chosen)
    out[col.name] = chosen === undefined || (target !== null && !offered.has(target))
      ? col.suggested
      : chosen
  }
  return out
}

/** The request body fields: plain policies, and the same-as map apart. */
export function splitObsPolicy(
  policy: Record<string, string>,
): { obs_policy: Record<string, string>; obs_merge_into: Record<string, string> } {
  const obs_policy: Record<string, string> = {}
  const obs_merge_into: Record<string, string> = {}
  for (const [name, value] of Object.entries(policy)) {
    const target = sameTarget(value)
    if (target !== null) obs_merge_into[name] = target
    else obs_policy[name] = value
  }
  return { obs_policy, obs_merge_into }
}

/** Target column → the columns declared the same as it. */
export function mergeTargets(policy: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [name, value] of Object.entries(policy)) {
    const target = sameTarget(value)
    if (target !== null) (out[target] ??= []).push(name)
  }
  return out
}

/** "9 merged · 2 kept separate · 1 dropped" — what will happen, in one line. */
export function summarizePolicy(
  columns: ColumnInfo[],
  policy: Record<string, string>,
): string {
  if (columns.length === 0) return 'none'
  let kept = 0
  let separate = 0
  let dropped = 0
  for (const col of columns) {
    const value = policy[col.name] ?? col.suggested
    if (value === 'drop') dropped += 1
    else if (value === 'separate') separate += 1
    else kept += 1
  }
  const parts: string[] = []
  if (kept) parts.push(`${kept} merged`)
  if (separate) parts.push(`${separate} kept separate`)
  if (dropped) parts.push(`${dropped} dropped`)
  return parts.join(' · ')
}
