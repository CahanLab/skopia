import { describe, it, expect } from 'vitest'
import { numberFieldDisplay } from './numberField'

// The parent pattern every modal used: coerce on each keystroke, falling back
// to a floor when the text is not a number. A controlled input showing that
// coerced value can never be emptied, so its first digit cannot be replaced.
const coerce = (raw: string) => Math.max(1, parseInt(raw) || 1)

/** Type a sequence of raw field texts while focused; return what is shown. */
function typeInto(start: number, texts: string[]) {
  let value: number = start
  let draft: string | null = null
  const shown: string[] = []
  for (const t of texts) {
    draft = t           // onChange
    value = coerce(t)   // the parent's setter
    shown.push(numberFieldDisplay(draft, value))
  }
  draft = null          // onBlur
  return { shown, value, afterBlur: numberFieldDisplay(draft, value) }
}

describe('numberFieldDisplay', () => {
  it('shows the parent value when the field is not being edited', () => {
    expect(numberFieldDisplay(null, 25)).toBe('25')
    expect(numberFieldDisplay(null, 0)).toBe('0')
    expect(numberFieldDisplay(null, null)).toBe('')
    expect(numberFieldDisplay(null, '0.05')).toBe('0.05')
  })

  it('lets a single-digit value be cleared and replaced', () => {
    // field holds 5; backspace, then type 3
    const r = typeInto(5, ['', '3'])
    expect(r.shown).toEqual(['', '3'])
    expect(r.value).toBe(3)
    expect(r.afterBlur).toBe('3')
  })

  it('lets the leading digit of a longer value be replaced', () => {
    // field holds 100; delete the leading 1 (leaving 00), then type 2
    const r = typeInto(100, ['00', '200'])
    expect(r.shown).toEqual(['00', '200'])
    expect(r.value).toBe(200)
  })

  it('shows the coerced value once the field loses focus', () => {
    const r = typeInto(5, [''])
    expect(r.value).toBe(1)
    expect(r.afterBlur).toBe('1')
  })
})
