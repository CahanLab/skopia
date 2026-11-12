import { useEffect, useRef, useState } from 'react'
import { estimateRemaining, formatDuration } from '../lib/taskProgress'

interface TaskProgressProps {
  /** 0..1 when the task reports it; null draws an indeterminate bar. */
  progress: number | null
  message: string | null
  /** Date.now() when the run started. */
  startedAt: number
}

/**
 * Progress strip for a running background task. Ticks its own clock so the
 * elapsed time moves between polls, and a task that never reports a fraction
 * still shows it is alive.
 */
export default function TaskProgress({ progress, message, startedAt }: TaskProgressProps) {
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef<HTMLDivElement>(null)
  // The strip mounts below the Run button, often past the bottom of a
  // scrolled modal, where nobody would see it.
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest' }) }, [])
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const elapsed = Math.max(0, (now - startedAt) / 1000)
  const determinate = typeof progress === 'number'
  const pct = determinate ? Math.round(progress * 100) : null
  const eta = estimateRemaining(progress, elapsed)

  return (
    <div ref={ref} style={styles.wrap} role="status" aria-live="polite">
      <style>{KEYFRAMES}</style>
      <div style={styles.message}>{message || 'Running…'}</div>
      <div style={styles.track}>
        {determinate
          ? <div style={{ ...styles.fill, width: `${pct}%` }} />
          : <div style={styles.sweep} />}
      </div>
      <div style={styles.meta}>
        <span>{pct != null ? `${pct}%` : ''}</span>
        <span>
          {formatDuration(elapsed)} elapsed
          {eta != null && ` · ~${formatDuration(eta)} left`}
        </span>
      </div>
    </div>
  )
}

const KEYFRAMES = '@keyframes skopia-task-sweep { 0% { left: -35%; } 100% { left: 100%; } }'

const styles: Record<string, React.CSSProperties> = {
  wrap: { marginTop: '10px' },
  message: { fontSize: '12px', color: '#9be7d8', marginBottom: '6px' },
  track: {
    position: 'relative', height: '8px', backgroundColor: '#0f1625',
    border: '1px solid #0f3460', borderRadius: '4px', overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: '#4ecdc4', transition: 'width 0.3s ease' },
  sweep: {
    position: 'absolute', top: 0, bottom: 0, width: '35%', backgroundColor: '#4ecdc4',
    opacity: 0.8, animation: 'skopia-task-sweep 1.4s ease-in-out infinite',
  },
  meta: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#888', marginTop: '4px' },
}
