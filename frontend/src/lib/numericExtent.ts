/**
 * Min and max of a per-cell numeric array, with nulls and non-finite values
 * skipped.
 *
 * A loop, not `Math.min(...values)`: spreading passes every value as a call
 * argument, and Chrome throws "Maximum call stack size exceeded" past ~125k of
 * them. Inside render that unmounted the whole app, so coloring a large
 * dataset by a continuous column left a blank page. Booleans read as 0/1, as
 * they did under Math.min. With nothing numeric the extent is 0..0, so a
 * legend never prints Infinity.
 */
export function numericExtent(
  // `ObsColumnData.values` is typed for every dtype; callers pass numeric ones.
  values: ArrayLike<number | string | boolean | null | undefined>,
): { min: number; max: number } {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null) continue
    const x = Number(v)
    if (!Number.isFinite(x)) continue
    if (x < min) min = x
    if (x > max) max = x
  }
  return min <= max ? { min, max } : { min: 0, max: 0 }
}
