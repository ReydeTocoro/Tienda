import { db } from '../index'
import type { Settings } from '../../types/settings'
import { sha256 } from '../../shared/lib/pin'
import { apiPut } from '../../api/client'

const DEFAULT_PIN = '1234'

/** Read path — unchanged: stays on the local Dexie mirror. The fallback default row created
 * here the first time a client reads before its first sync pull lands is never sent to the
 * server, but it's harmless: server/db.ts seeds the exact same defaults (same hash of "1234")
 * on its own first run, and the next sync pull overwrites this local row with the server's
 * authoritative copy anyway. */
export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('main')
  if (existing) return existing

  const defaults: Settings = {
    key: 'main',
    storeName: 'Mi Tienda',
    pinHash: await sha256(DEFAULT_PIN),
    pinLength: 4,
    theme: 'light',
    hidScannerEnabled: true,
  }
  await db.settings.put(defaults)
  return defaults
}

export async function updateSettings(patch: Partial<Omit<Settings, 'key'>>): Promise<void> {
  await apiPut('/api/settings', patch)
}
