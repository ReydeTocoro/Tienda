import { db } from '../index'
import type { Settings } from '../../types/settings'
import { sha256 } from '../../shared/lib/pin'

const DEFAULT_PIN = '1234'

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
  const current = await getSettings()
  await db.settings.put({ ...current, ...patch })
}
