// The app was called xcell until 0.6, and its per-browser conveniences
// (recent files, last browse directory, export settings, ...) sit in
// localStorage under `xcell_*` keys. Rename them once so the first start
// after the rename keeps what the user had. Keys are copied, not merged:
// a `skopia_*` key already present was written by this version and wins.

export const STORAGE_PREFIX = 'skopia_'
export const LEGACY_STORAGE_PREFIX = 'xcell_'

/** Minimal Storage surface, so the migration is testable without a DOM. */
export interface KeyValueStore {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Rename every `xcell_*` key to `skopia_*`; returns the keys renamed. */
export function migrateLegacyStorageKeys(store: KeyValueStore): string[] {
  const legacy: string[] = []
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i)
    if (k && k.startsWith(LEGACY_STORAGE_PREFIX)) legacy.push(k)
  }
  const renamed: string[] = []
  for (const old of legacy) {
    const next = STORAGE_PREFIX + old.slice(LEGACY_STORAGE_PREFIX.length)
    const value = store.getItem(old)
    if (value !== null && store.getItem(next) === null) {
      store.setItem(next, value)
      renamed.push(next)
    }
    store.removeItem(old)
  }
  return renamed
}

/** Run the migration against window.localStorage; never throw (private windows, blocked storage). */
export function migrateBrowserStorage(): void {
  try {
    migrateLegacyStorageKeys(window.localStorage)
  } catch {
    /* storage unavailable: nothing to migrate */
  }
}
