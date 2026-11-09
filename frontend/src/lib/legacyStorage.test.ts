import { describe, it, expect } from 'vitest'
import { migrateLegacyStorageKeys, type KeyValueStore } from './legacyStorage'

function memoryStore(init: Record<string, string>): KeyValueStore & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i) => Array.from(m.keys())[i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v) },
    removeItem: (k) => { m.delete(k) },
    dump: () => Object.fromEntries(m),
  }
}

describe('migrateLegacyStorageKeys', () => {
  it('renames xcell_ keys to skopia_ and leaves other keys alone', () => {
    const s = memoryStore({ xcell_recentFiles: '["a"]', xcell_lastBrowseDir: '/d', theme: 'dark' })
    const renamed = migrateLegacyStorageKeys(s)
    expect(renamed.sort()).toEqual(['skopia_lastBrowseDir', 'skopia_recentFiles'])
    expect(s.dump()).toEqual({ skopia_recentFiles: '["a"]', skopia_lastBrowseDir: '/d', theme: 'dark' })
  })

  it('keeps an existing skopia_ value and drops the legacy one', () => {
    const s = memoryStore({ xcell_recentFiles: '["old"]', skopia_recentFiles: '["new"]' })
    expect(migrateLegacyStorageKeys(s)).toEqual([])
    expect(s.dump()).toEqual({ skopia_recentFiles: '["new"]' })
  })

  it('is a no-op on a store without legacy keys', () => {
    const s = memoryStore({ skopia_qced: '1' })
    expect(migrateLegacyStorageKeys(s)).toEqual([])
    expect(s.dump()).toEqual({ skopia_qced: '1' })
  })
})
