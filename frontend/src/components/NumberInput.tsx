import { useState, type InputHTMLAttributes } from 'react'
import { numberFieldDisplay } from '../lib/numberField'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> & {
  value: number | string | null | undefined
}

/**
 * `<input type="number">` that shows the user's own text while it has focus.
 *
 * A drop-in replacement: `onChange` still receives every change event, so a
 * parent that coerces each keystroke (`Math.max(1, parseInt(v) || 1)`) keeps
 * doing so. Only the display differs: it no longer snaps to the coerced value
 * mid-edit, which made a lone digit impossible to clear and replace. The
 * parent's value shows again on blur. See lib/numberField.ts.
 */
export default function NumberInput({ value, onChange, onFocus, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      {...rest}
      type="number"
      value={numberFieldDisplay(draft, value)}
      onFocus={(e) => { setDraft(null); onFocus?.(e) }}
      onChange={(e) => { setDraft(e.target.value); onChange?.(e) }}
      onBlur={(e) => { setDraft(null); onBlur?.(e) }}
    />
  )
}
