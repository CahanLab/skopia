/**
 * What a number field shows: the user's own text while they are editing it,
 * otherwise the parent's value.
 *
 * Most modals coerce on every keystroke (`Math.max(1, parseInt(v) || 1)`), and
 * a controlled input that shows the coerced value can never be emptied: clear
 * a lone 5 and it snaps to 1, so typing 3 gives 13. Showing the draft while
 * focused lets the parent keep coercing and the user keep typing; the coerced
 * value appears on blur.
 */
export function numberFieldDisplay(
  draft: string | null,
  value: number | string | null | undefined,
): string {
  if (draft !== null) return draft
  return value == null ? '' : String(value)
}
