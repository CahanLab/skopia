import { forwardRef, useMemo } from 'react'
import { divergingColor, sequentialColor, truncate, type ExpressionDotplotData } from '../../lib/figures'

/** Scanpy-style dot plot: one dot per gene × group, its area the fraction of
 *  the group's cells expressing the gene and its colour the mean expression.
 *  Groups are rows and genes columns (scanpy's layout) unless `swap_axes`.
 *  Pure SVG, so it exports as vector; shared by the Heatmap tab and the
 *  Figures tab. */

export interface ExpressionDotplotFigureProps {
  data: ExpressionDotplotData
  params: Record<string, unknown>
  title?: string
  width?: number
  background?: string
  onGeneClick?: (gene: string) => void
}

const FONT = 'Inter, system-ui, sans-serif'
const GROUP_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']

/** Contiguous runs of the same row group, as [name, start, size]. */
function runs(groups: (string | null)[]): { name: string; start: number; size: number }[] {
  const out: { name: string; start: number; size: number }[] = []
  groups.forEach((g, i) => {
    if (g && out.length && out[out.length - 1].name === g && out[out.length - 1].start + out[out.length - 1].size === i) out[out.length - 1].size++
    else if (g) out.push({ name: g, start: i, size: 1 })
  })
  return out
}

export const ExpressionDotplotFigure = forwardRef<SVGSVGElement, ExpressionDotplotFigureProps>(function ExpressionDotplotFigure(
  { data, params, title, width, background = '#16213e', onGeneClick },
  ref,
) {
  const swap = Boolean(params.swap_axes)
  const colormap = String(params.colormap ?? 'viridis')
  const dotMax = typeof params.dot_max === 'number' && params.dot_max > 0 ? Math.min(1, params.dot_max) : 1
  const nGenes = data.genes.length
  const nCats = data.categories.length
  const nCols = swap ? nCats : nGenes
  const nRows = swap ? nGenes : nCats

  const vmax = useMemo(() => {
    const p = params.vmax
    if (typeof p === 'number' && p > 0) return p
    let m = 0
    for (const row of data.mean) for (const v of row) m = Math.max(m, Math.abs(v))
    return m || 1
  }, [data.mean, params.vmax])

  // Cell size follows the width available, within what a dot and a label can use.
  const cell = Math.max(14, Math.min(28, Math.floor(((width ?? 600) - 160) / Math.max(1, nCols))))
  const fontSize = Math.max(8, Math.min(12, cell * 0.6))
  const rowNames = (swap ? data.genes : data.categories).map((s) => truncate(s, 28))
  const colNames = (swap ? data.categories : data.genes).map((s) => truncate(s, 24))
  const groupRuns = runs(data.row_groups)
  const groupNames = Array.from(new Set(groupRuns.map((r) => r.name)))
  const groupColor = (name: string) => GROUP_COLORS[groupNames.indexOf(name) % GROUP_COLORS.length]
  const rowLabelW = Math.min(240, 10 + Math.max(0, ...rowNames.map((l) => l.length)) * fontSize * 0.62) + (swap && groupRuns.length ? 12 : 0)
  const colLabelH = Math.min(150, 10 + Math.max(0, ...colNames.map((l) => l.length)) * fontSize * 0.55) + (!swap && groupRuns.length ? 16 : 0)
  const titleH = title ? 24 : 0
  const left = rowLabelW + 8
  const top = titleH + colLabelH + 8
  const gridW = nCols * cell
  const gridH = nRows * cell
  const legendW = 150
  const svgW = Math.max(width ?? 0, left + gridW + legendW + 48, title ? 24 + title.length * 7 : 0)
  const legendBlockH = 56 + 3 * 16
  const svgH = top + Math.max(gridH, legendBlockH) + 24

  if (nGenes === 0 || nCats === 0) {
    return (
      <svg ref={ref} data-figure-svg width={Math.max(width ?? 480, 480)} height={80} style={{ background, fontFamily: FONT }}>
        {title && <text x={12} y={20} fill="#eee" fontSize={13} fontWeight={600}>{title}</text>}
        <text x={12} y={titleH + 30} fill="#aaa" fontSize={12}>
          {data.n_genes_hidden ? `${data.n_genes_hidden} gene${data.n_genes_hidden === 1 ? ' is' : 's are'} hidden by the gene mask` : 'Nothing to draw'}
        </text>
      </svg>
    )
  }

  const rMax = cell / 2 - 1.5
  const radius = (pct: number) => rMax * Math.sqrt(Math.max(0, Math.min(1, pct / dotMax)))
  const color = (mean: number) => (colormap === 'rdbu' ? divergingColor(mean, vmax, 'rdbu') : sequentialColor(mean / vmax, colormap))
  const at = (gi: number, ci: number) => (swap ? { col: ci, row: gi } : { col: gi, row: ci })
  const legendX = left + gridW + 28
  const legendY = top
  const sizeStops = [0.25, 0.5, 1.0].map((f) => f * dotMax)
  const colorStops = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg ref={ref} data-figure-svg width={svgW} height={svgH} style={{ background, fontFamily: FONT, display: 'block' }}>
      {title && <text x={12} y={17} fill="#eee" fontSize={13} fontWeight={600}>{title}</text>}
      {/* gene-set / marker-group brackets */}
      {groupRuns.map((r) => swap ? (
        <g key={`${r.name}-${r.start}`}>
          <rect x={left - 10} y={top + r.start * cell + 1} width={4} height={r.size * cell - 2} fill={groupColor(r.name)}>
            <title>{r.name}</title>
          </rect>
        </g>
      ) : (
        <g key={`${r.name}-${r.start}`}>
          <rect x={left + r.start * cell + 1} y={top - 12} width={r.size * cell - 2} height={4} fill={groupColor(r.name)} />
          <text x={left + r.start * cell + (r.size * cell) / 2} y={top - 15} fill={groupColor(r.name)} fontSize={Math.max(7, fontSize - 2)} textAnchor="middle">
            {truncate(r.name, Math.max(3, Math.floor((r.size * cell) / (fontSize * 0.55))))}
            <title>{r.name}</title>
          </text>
        </g>
      ))}
      {/* column labels, rotated */}
      {colNames.map((label, j) => (
        <text
          key={j} fill="#ccc" fontSize={fontSize}
          transform={`translate(${left + j * cell + cell / 2 + fontSize * 0.35}, ${top - (groupRuns.length && !swap ? 20 : 6)}) rotate(-45)`}
          textAnchor="start"
          style={!swap && onGeneClick ? { cursor: 'pointer' } : undefined}
          onClick={!swap && onGeneClick ? () => onGeneClick(data.genes[j]) : undefined}
        >
          {label}
        </text>
      ))}
      {/* row labels, with the category colour when the dataset has one */}
      {rowNames.map((label, i) => (
        <g key={i}>
          {!swap && data.category_colors?.[i] && (
            <rect x={left - 8} y={top + i * cell + cell / 2 - 4} width={5} height={8} fill={data.category_colors[i] ?? '#888'} />
          )}
          <text
            x={left - 12} y={top + i * cell + cell / 2 + fontSize * 0.35} fill="#ccc" fontSize={fontSize} textAnchor="end"
            style={swap && onGeneClick ? { cursor: 'pointer' } : undefined}
            onClick={swap && onGeneClick ? () => onGeneClick(data.genes[i]) : undefined}
          >
            <title>{swap ? data.genes[i] : `${data.categories[i]} · ${data.n_cells_per_category[i].toLocaleString()} cells`}</title>
            {label}
          </text>
        </g>
      ))}
      {/* grid lines */}
      {Array.from({ length: nRows + 1 }, (_, i) => (
        <line key={`h${i}`} x1={left} x2={left + gridW} y1={top + i * cell} y2={top + i * cell} stroke="#0f3460" strokeWidth={0.5} />
      ))}
      {Array.from({ length: nCols + 1 }, (_, j) => (
        <line key={`v${j}`} x1={left + j * cell} x2={left + j * cell} y1={top} y2={top + gridH} stroke="#0f3460" strokeWidth={0.5} />
      ))}
      {/* dots */}
      {data.genes.map((gene, gi) => data.categories.map((cat, ci) => {
        const { col, row } = at(gi, ci)
        const pct = data.pct[gi][ci]
        const mean = data.mean[gi][ci]
        const r = radius(pct)
        if (r <= 0) return null
        return (
          <circle key={`${gi}-${ci}`} cx={left + col * cell + cell / 2} cy={top + row * cell + cell / 2} r={r} fill={color(mean)} stroke={background} strokeWidth={0.5}>
            <title>{`${gene} in ${cat}: ${(pct * 100).toFixed(0)}% expressing, ${data.color_label.toLowerCase()} ${mean.toFixed(2)}`}</title>
          </circle>
        )
      }))}
      {/* legends: dot size, then colour */}
      <text x={legendX} y={legendY + 10} fill="#ccc" fontSize={10}>Fraction of cells</text>
      {sizeStops.map((f, k) => (
        <g key={k}>
          <circle cx={legendX + rMax + 2} cy={legendY + 24 + k * (2 * rMax + 6) + rMax} r={radius(f)} fill="#ccc" />
          <text x={legendX + 2 * rMax + 12} y={legendY + 24 + k * (2 * rMax + 6) + rMax + 3.5} fill="#aaa" fontSize={9}>{`${Math.round(f * 100)}%`}</text>
        </g>
      ))}
      <defs>
        <linearGradient id="dotplot-color-legend" x1="0" x2="1" y1="0" y2="0">
          {colorStops.map((s, k) => <stop key={k} offset={`${s * 100}%`} stopColor={color(s * vmax)} />)}
        </linearGradient>
      </defs>
      {(() => {
        const y = legendY + 24 + 3 * (2 * rMax + 6) + 14
        return (
          <g>
            <text x={legendX} y={y} fill="#ccc" fontSize={10}>{data.color_label}</text>
            <rect x={legendX} y={y + 6} width={legendW} height={10} fill="url(#dotplot-color-legend)" stroke="#0f3460" strokeWidth={0.5} />
            <text x={legendX} y={y + 28} fill="#aaa" fontSize={9}>0</text>
            <text x={legendX + legendW} y={y + 28} fill="#aaa" fontSize={9} textAnchor="end">{vmax >= 10 ? vmax.toFixed(0) : vmax.toFixed(2)}</text>
            {!!data.n_genes_hidden && (
              <text x={legendX} y={y + 44} fill="#e9a23b" fontSize={9}>{`${data.n_genes_hidden} hidden by gene mask`}</text>
            )}
          </g>
        )
      })()}
    </svg>
  )
})

export default ExpressionDotplotFigure
