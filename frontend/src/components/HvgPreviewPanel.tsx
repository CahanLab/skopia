import { useEffect, useMemo, useRef, useState } from 'react'
import { linearTicks, log10Ticks, hvgPreviewSummary, hvgErrorMessage, type HvgPreview } from '../lib/hvgPreview'

const W = 460
const H = 230
const M = { l: 46, r: 10, t: 10, b: 34 }
const HV_COLOR = '#4ecdc4'
const OTHER_COLOR = 'rgba(140, 150, 170, 0.55)'
const CUT_COLOR = '#e94560'

const dark = {
  box: { marginBottom: '12px', padding: '8px', backgroundColor: '#0f1625', border: '1px solid #0f3460', borderRadius: '4px' } as const,
  title: { fontSize: '11px', color: '#aaa', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' } as const,
  hint: { fontSize: '11px', color: '#888' } as const,
  swatch: (c: string) => ({ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: c, marginRight: '4px' }),
}

function fmt(v: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1000 || a < 0.01) return v.toExponential(0)
  return String(Number(v.toPrecision(3)))
}

/**
 * Mean vs normalized dispersion for every gene, coloured by whether the
 * modal's current settings select it. The flags come from the backend
 * running the same scanpy call as the run (inplace=False), so what is
 * coloured here is what the run will write.
 */
export function HvgPreviewPanel({ preview, loading, error, splitBy, flavor }: {
  preview: HvgPreview | null
  loading: boolean
  error: string | null
  /** The method asked for, to explain a failure in its terms. */
  flavor: string
  /** A split run detects within each group; there is no single plot of it. */
  splitBy: string | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const layout = useMemo(() => {
    if (!preview || preview.x.length === 0) return null
    const tx = preview.x_log ? (v: number) => Math.log10(v) : (v: number) => v
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < preview.x.length; i++) {
      const xv = tx(preview.x[i]), yv = preview.y[i]
      if (xv < x0) x0 = xv
      if (xv > x1) x1 = xv
      if (yv < y0) y0 = yv
      if (yv > y1) y1 = yv
    }
    if (preview.thresholds) {
      // Keep the cutoffs on the plot when they sit just past the data.
      y0 = Math.min(y0, preview.thresholds.min_disp)
      y1 = Math.max(y1, preview.thresholds.min_disp)
    }
    const padX = (x1 - x0) * 0.03 || 1
    const padY = (y1 - y0) * 0.05 || 1
    x0 -= padX; x1 += padX; y0 -= padY; y1 += padY
    const pw = W - M.l - M.r, ph = H - M.t - M.b
    const sx = (v: number) => M.l + ((tx(v) - x0) / (x1 - x0)) * pw
    const sy = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * ph
    const xTicks = preview.x_log ? log10Ticks(10 ** x0, 10 ** x1) : linearTicks(x0, x1, 6)
    const yTicks = linearTicks(y0, y1, 5)
    return { sx, sy, xTicks, yTicks, xMin: preview.x_log ? 10 ** x0 : x0, xMax: preview.x_log ? 10 ** x1 : x1 }
  }, [preview])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !preview || !layout) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const { sx, sy, xTicks, yTicks } = layout

    // axes
    ctx.strokeStyle = '#33405a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(M.l, M.t); ctx.lineTo(M.l, H - M.b); ctx.lineTo(W - M.r, H - M.b)
    ctx.stroke()
    ctx.fillStyle = '#888'
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'center'
    for (const t of xTicks) {
      const px = sx(t)
      if (px < M.l || px > W - M.r) continue
      ctx.fillRect(px, H - M.b, 1, 3)
      ctx.fillText(fmt(t), px, H - M.b + 13)
    }
    ctx.textAlign = 'right'
    for (const t of yTicks) {
      const py = sy(t)
      if (py < M.t || py > H - M.b) continue
      ctx.fillRect(M.l - 3, py, 3, 1)
      ctx.fillText(fmt(t), M.l - 5, py + 3)
    }
    ctx.textAlign = 'center'
    ctx.fillText(preview.x_label, M.l + (W - M.l - M.r) / 2, H - 4)
    ctx.save()
    ctx.translate(11, M.t + (H - M.t - M.b) / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(preview.y_label, 0, 0)
    ctx.restore()

    // points: the unselected first so the selected sit on top
    const draw = (selected: boolean) => {
      ctx.fillStyle = selected ? HV_COLOR : OTHER_COLOR
      for (let i = 0; i < preview.x.length; i++) {
        if (preview.highly_variable[i] !== selected) continue
        const px = sx(preview.x[i]), py = sy(preview.y[i])
        if (preview.off_scale[i]) {
          // infinite dispersion, pinned to the edge: an upward triangle
          ctx.beginPath()
          ctx.moveTo(px, py - 3); ctx.lineTo(px - 3, py + 2); ctx.lineTo(px + 3, py + 2)
          ctx.fill()
        } else {
          ctx.fillRect(px - 1.25, py - 1.25, 2.5, 2.5)
        }
      }
    }
    draw(false)
    draw(true)

    // cutoffs
    const th = preview.thresholds
    if (th) {
      ctx.strokeStyle = CUT_COLOR
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      for (const v of [th.min_mean, th.max_mean]) {
        const px = sx(v)
        if (px >= M.l && px <= W - M.r) { ctx.moveTo(px, M.t); ctx.lineTo(px, H - M.b) }
      }
      const py = sy(th.min_disp)
      if (py >= M.t && py <= H - M.b) { ctx.moveTo(M.l, py); ctx.lineTo(W - M.r, py) }
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (hover != null) {
      const px = sx(preview.x[hover]), py = sy(preview.y[hover])
      ctx.strokeStyle = '#fff'
      ctx.beginPath()
      ctx.arc(px, py, 4, 0, Math.PI * 2)
      ctx.stroke()
    }
  }, [preview, layout, hover])

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!preview || !layout) return
    const r = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - r.left) / r.width) * W
    const my = ((e.clientY - r.top) / r.height) * H
    let best = -1, bestD = 36 // within 6 px
    for (let i = 0; i < preview.x.length; i++) {
      const dx = layout.sx(preview.x[i]) - mx, dy = layout.sy(preview.y[i]) - my
      const d = dx * dx + dy * dy
      if (d < bestD) { bestD = d; best = i }
    }
    setHover(best >= 0 ? best : null)
  }

  if (splitBy) {
    return (
      <div style={dark.box}>
        <div style={dark.hint}>
          No preview with “Detect within groups of” set: each group of {splitBy} gets its own selection.
        </div>
      </div>
    )
  }

  return (
    <div style={dark.box} data-hvg-preview>
      <div style={dark.title}>
        <span style={{ flex: 1 }}>Preview: genes these settings select</span>
        {loading && <span style={dark.hint}>updating…</span>}
      </div>
      {error && <div style={{ fontSize: '11px', color: '#e94560', marginBottom: '4px' }} data-hvg-preview-error>{hvgErrorMessage(error, flavor)}</div>}
      {/* A stale plot under an error would show a selection the run cannot make. */}
      {!error && preview && layout ? (
        <>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', maxWidth: `${W}px`, aspectRatio: `${W} / ${H}`, display: 'block', opacity: loading ? 0.6 : 1 }}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
          <div style={{ ...dark.hint, display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
            <span><span style={dark.swatch(HV_COLOR)} />highly variable</span>
            <span><span style={dark.swatch('#8c96aa')} />other</span>
            {preview.thresholds && <span style={{ color: CUT_COLOR }}>- - cutoffs</span>}
            {preview.off_scale.some(Boolean) && <span>▲ infinite dispersion, drawn at the top</span>}
            <span style={{ marginLeft: 'auto', color: '#ccc' }}>
              {hover != null
                ? `${preview.genes[hover]}: mean ${fmt(preview.x[hover])}, ${preview.off_scale[hover] ? '∞' : fmt(preview.y[hover])}`
                : ''}
            </span>
          </div>
          <div style={{ ...dark.hint, marginTop: '2px' }} data-hvg-preview-summary>
            {hvgPreviewSummary(preview)}
            {!preview.thresholds && preview.flavor !== 'seurat_v3' && ' · Top N is set, so the mean and dispersion cutoffs do not apply'}
          </div>
        </>
      ) : !error && (
        <div style={dark.hint}>{loading ? 'Computing…' : 'No genes to show.'}</div>
      )}
    </div>
  )
}
