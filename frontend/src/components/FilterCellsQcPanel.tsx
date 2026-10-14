import { useMemo, useState } from 'react'
import { QcThresholdChart } from './QcThresholdChart'
import { formatCount, formatPercent, passingCount } from '../lib/filterCellsQc'

export interface MitoSource {
  kind: 'var_column' | 'pattern'
  name: string
  n_genes: number
}

export interface FilterCellsDistributions {
  counts: Array<number | null>
  genes: Array<number | null>
  /** % of each cell's counts from mitochondrial genes; null when none were found. */
  pct_mt: Array<number | null> | null
  mt_source: MitoSource | null
}

const dark = {
  hint: { fontSize: '11px', color: '#888' } as const,
  passLine: { fontSize: '12px', color: '#4ecdc4', margin: '6px 0 2px' } as const,
  toggleRow: {
    display: 'flex', alignItems: 'center', gap: '6px',
    fontSize: '11px', color: '#aaa', margin: '2px 0 8px', cursor: 'pointer',
  } as const,
}

export function describeMitoSource(s: MitoSource): string {
  return s.kind === 'var_column'
    ? `${s.n_genes} genes flagged in .var["${s.name}"]`
    : `${s.n_genes} genes named ${s.name.replace('^', '')}… (either case)`
}

/** The Filter Cells preamble: counts / genes / % mitochondrial histograms
 * whose draggable cutoffs set the same thresholds as the inputs below them,
 * plus a live count of what the current thresholds would keep. */
export function FilterCellsQcPanel({
  dist,
  error,
  minCounts,
  maxCounts,
  minGenes,
  maxGenes,
  minPctMt,
  maxPctMt,
  onChangeThreshold,
}: {
  dist: FilterCellsDistributions | null
  error: string | null
  minCounts: number | null
  maxCounts: number | null
  minGenes: number | null
  maxGenes: number | null
  minPctMt: number | null
  maxPctMt: number | null
  onChangeThreshold: (name: string, value: number | null) => void
}) {
  const [log, setLog] = useState(true)

  const passing = useMemo(
    () => (dist
      ? passingCount(dist.counts, dist.genes, {
          minCounts, maxCounts, minGenes, maxGenes, minPctMt, maxPctMt,
        }, dist.pct_mt)
      : null),
    [dist, minCounts, maxCounts, minGenes, maxGenes, minPctMt, maxPctMt],
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
        log₁₀(1+x) axis for counts and genes
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <QcThresholdChart
          title="Total counts per cell — drag the red lines to set Min/Max counts"
          values={dist.counts}
          lo={minCounts}
          hi={maxCounts}
          log={log}
          formatValue={formatCount}
          onChange={(which, v) =>
            onChangeThreshold(which === 'lo' ? 'min_counts' : 'max_counts', v)}
        />
        <QcThresholdChart
          title="Genes per cell — drag the red lines to set Min/Max genes"
          values={dist.genes}
          lo={minGenes}
          hi={maxGenes}
          log={log}
          formatValue={formatCount}
          onChange={(which, v) =>
            onChangeThreshold(which === 'lo' ? 'min_genes' : 'max_genes', v)}
        />
        {dist.pct_mt && dist.mt_source ? (
          <div>
            <QcThresholdChart
              title="Mitochondrial counts per cell (%) — drag the red lines to set Min/Max % mito"
              values={dist.pct_mt}
              lo={minPctMt}
              hi={maxPctMt}
              log={false}
              decimals={2}
              formatValue={formatPercent}
              onChange={(which, v) =>
                onChangeThreshold(which === 'lo' ? 'min_pct_mt' : 'max_pct_mt', v)}
            />
            <div style={dark.hint}>Mitochondrial: {describeMitoSource(dist.mt_source)}.</div>
          </div>
        ) : (
          <div style={dark.hint}>
            No mitochondrial genes found (no boolean .var["mt"] column and no gene named mt-… / MT-…),
            so there is no % mito histogram. Flag them with Genes → Add boolean column.
          </div>
        )}
      </div>
      {passing != null && (
        <div style={dark.passLine}>
          {passing.toLocaleString()} of {dist.counts.length.toLocaleString()} cells
          pass the current thresholds
        </div>
      )}
    </div>
  )
}
