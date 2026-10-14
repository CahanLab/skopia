import { useMemo, useState } from 'react'
import { QcThresholdChart } from './QcThresholdChart'
import { formatCount, passingCount } from '../lib/filterCellsQc'
import { percentOfCells, percentFromCells } from '../lib/percentOfCells'

export interface FilterGenesDistributions {
  counts: Array<number | null>
  cells: Array<number | null>
  n_cells: number
}

const dark = {
  hint: { fontSize: '11px', color: '#888' } as const,
  passLine: { fontSize: '12px', color: '#4ecdc4', margin: '6px 0 2px' } as const,
  toggleRow: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '11px', color: '#aaa', margin: '2px 0 8px', cursor: 'pointer',
  } as const,
}

/** The Filter Genes preamble: per-gene total counts and cells-expressing
 * histograms whose draggable cutoffs set the inputs below. The cells chart
 * is drawn in cells, while the Min cells input is a percentage of the
 * dataset: the low cutoff converts through the same rounding the request
 * uses, so what the line shows is the count scanpy will be given. */
export function FilterGenesQcPanel({
  dist,
  error,
  minCounts,
  maxCounts,
  minCellsPct,
  maxCells,
  onChangeThreshold,
}: {
  dist: FilterGenesDistributions | null
  error: string | null
  minCounts: number | null
  maxCounts: number | null
  minCellsPct: number | null
  maxCells: number | null
  onChangeThreshold: (name: string, value: number | null) => void
}) {
  const [log, setLog] = useState(true)
  const minCells = dist && minCellsPct != null && minCellsPct > 0
    ? percentOfCells(minCellsPct, dist.n_cells)
    : null

  // The same rule as the cell filter: AND of inclusive bounds, per gene.
  const passing = useMemo(
    () => (dist
      ? passingCount(dist.counts, dist.cells, {
          minCounts, maxCounts, minGenes: minCells, maxGenes: maxCells,
        })
      : null),
    [dist, minCounts, maxCounts, minCells, maxCells],
  )

  if (error) return <div style={dark.hint}>Distributions unavailable: {error}</div>
  if (!dist) return <div style={dark.hint}>Loading distributions…</div>

  return (
    <div style={{ marginBottom: '10px' }}>
      <label style={dark.toggleRow}>
        <input
          type="checkbox"
          checked={log}
          onChange={(e) => setLog(e.target.checked)}
        />
        log₁₀(1+x) axis
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <QcThresholdChart
          title="Total counts per gene — drag the red lines to set Min/Max counts"
          values={dist.counts}
          lo={minCounts}
          hi={maxCounts}
          log={log}
          formatValue={formatCount}
          onChange={(which, v) =>
            onChangeThreshold(which === 'lo' ? 'min_counts' : 'max_counts', v)}
        />
        <QcThresholdChart
          title="Cells expressing each gene — drag the red lines to set Min cells (as % of cells) / Max cells"
          values={dist.cells}
          lo={minCells}
          hi={maxCells}
          log={log}
          formatValue={formatCount}
          onChange={(which, v) => {
            if (which === 'lo') onChangeThreshold('min_cells_pct', v == null ? null : percentFromCells(v, dist.n_cells))
            else onChangeThreshold('max_cells', v)
          }}
        />
      </div>
      {passing != null && (
        <div style={dark.passLine}>
          {passing.toLocaleString()} of {dist.counts.length.toLocaleString()} genes
          pass the current thresholds
        </div>
      )}
    </div>
  )
}
