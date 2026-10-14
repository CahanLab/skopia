import { useEffect, useMemo, useState } from 'react'
import { computeHistogram, HistogramChart } from '../utils/histogram'
import { toChartSpace, fromChartSpace, madBounds } from '../lib/filterCellsQc'

const dark = {
  titleRow: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' } as const,
  label: { fontSize: '11px', color: '#aaa', flex: 1 } as const,
  hint: { fontSize: '11px', color: '#888' } as const,
  madLabel: { fontSize: '11px', color: '#888', whiteSpace: 'nowrap' } as const,
  madInput: {
    width: '44px', padding: '2px 4px', fontSize: '11px', color: '#eee',
    backgroundColor: '#0f1625', border: '1px solid #0f3460', borderRadius: '3px',
  } as const,
}

/** One histogram with draggable min/max cutoffs bound to two thresholds, and
 * a ± MAD box that places both at median ± k·MAD on the axis as drawn.
 *
 * The MAD box is a shortcut, not a parameter: it fills the same two
 * thresholds the lines and the inputs below set, and it clears itself as
 * soon as either threshold stops matching what it placed. */
export function QcThresholdChart({
  title,
  values,
  lo,
  hi,
  log,
  decimals = 0,
  formatValue,
  onChange,
}: {
  title: string
  values: Array<number | null>
  lo: number | null
  hi: number | null
  log: boolean
  /** Rounding of a dragged or MAD-placed cutoff: 0 for counts, 2 for a percentage. */
  decimals?: number
  formatValue: (raw: number) => string
  onChange: (which: 'lo' | 'hi', value: number | null) => void
}) {
  const chartValues = useMemo(
    () => (log ? values.map((v) => (v == null ? null : toChartSpace(v, true))) : values),
    [values, log],
  )
  const histogram = useMemo(() => computeHistogram(chartValues, 60), [chartValues])
  // Raw-space extent, for edge-clearing: a cutoff dragged to the axis end
  // means "no threshold", shown as the empty input beside it.
  const rawMin = useMemo(() => fromChartSpace(histogram.min, log, decimals), [histogram.min, log, decimals])
  const rawMax = useMemo(() => fromChartSpace(histogram.max, log, decimals), [histogram.max, log, decimals])

  const [madK, setMadK] = useState('')
  const k = parseFloat(madK)
  const placed = useMemo(
    () => (Number.isFinite(k) && k > 0 ? madBounds(values, k, log, decimals) : null),
    [values, k, log, decimals],
  )
  // Re-place when the axis changes under a live k; forget k when the
  // thresholds no longer match it (a drag, or a typed value below).
  useEffect(() => {
    if (!placed) return
    if (placed.lo !== lo) onChange('lo', placed.lo)
    if (placed.hi !== hi) onChange('hi', placed.hi)
    // Only the axis (log) and k re-place; lo/hi changes are checked below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed])
  useEffect(() => {
    if (placed && (placed.lo !== lo || placed.hi !== hi)) setMadK('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lo, hi])

  if (histogram.zeroVariance) {
    return (
      <div>
        <div style={dark.label}>{title}</div>
        <div style={dark.hint}>Every value is the same — nothing to threshold.</div>
      </div>
    )
  }

  const handle = (which: 'lo' | 'hi') => (chartValue: number) => {
    const raw = fromChartSpace(chartValue, log, decimals)
    if (which === 'lo') onChange('lo', raw <= rawMin ? null : raw)
    else onChange('hi', raw >= rawMax ? null : raw)
  }

  return (
    <div>
      <div style={dark.titleRow}>
        <div style={dark.label}>{title}</div>
        <label
          style={dark.madLabel}
          title="Set both cutoffs at median ± k · MAD (unscaled median absolute deviation, as in scipy and the sc-best-practices QC chapter), measured on the axis as drawn. A cutoff beyond the data is left unset. Dragging a line clears it."
        >
          ± MAD{' '}
          <input
            type="number"
            min="0"
            step="0.5"
            placeholder="k"
            value={madK}
            onChange={(e) => setMadK(e.target.value)}
            style={dark.madInput}
          />
        </label>
      </div>
      <HistogramChart
        histogram={histogram}
        mode="between"
        lo={lo != null ? toChartSpace(lo, log) : histogram.min}
        hi={hi != null ? toChartSpace(hi, log) : histogram.max}
        onChangeLo={handle('lo')}
        onChangeHi={handle('hi')}
        width={460}
        height={104}
        formatValue={(v) => formatValue(fromChartSpace(v, log, decimals))}
      />
    </div>
  )
}
