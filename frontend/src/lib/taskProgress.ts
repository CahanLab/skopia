/** Elapsed / remaining time for a background task's progress strip. */

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/**
 * Seconds left at the rate so far, or null when a guess would mislead: before
 * 5% or 3 s the rate is mostly startup (copying the data, building a graph).
 */
export function estimateRemaining(frac: number | null | undefined, elapsedSeconds: number): number | null {
  if (frac == null || frac < 0.05 || frac >= 1 || elapsedSeconds < 3) return null
  return (elapsedSeconds * (1 - frac)) / frac
}
