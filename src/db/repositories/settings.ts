import { db } from '../index'
import type { Settings } from '../../types/settings'
import { apiPut } from '../../api/client'

/** Read path — unchanged: stays on the local Dexie mirror. The fallback default row created
 * here the first time a client reads before its first sync pull lands is never sent to the
 * server, but it's harmless: the first migration seeds the same defaults, and the next sync pull
 * overwrites this local row with the server's authoritative copy anyway. (No PIN in it: PINs are
 * checked by the server only.) */
export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.get('main')
  if (existing) return existing

  const defaults: Settings = {
    key: 'main',
    storeName: 'Mi Tienda',
    pinLength: 4,
    theme: 'light',
    hidScannerEnabled: true,
  }
  // `add`, not `put`: the sync pull may have landed meanwhile, and a `put` would overwrite the
  // server's real settings with these defaults.
  try {
    await db.settings.add(defaults)
    return defaults
  } catch {
    return (await db.settings.get('main')) ?? defaults
  }
}

/** What the settings route takes (server/domain/users.ts): the theme from anyone, the rest from the
 * Administrador (`owner` replaces the owner's whole profile). The master PIN, the caja's base and the
 * last cashier have their own routes. */
export type SettingsPatch = Partial<Pick<Settings, 'theme' | 'storeName' | 'business' | 'roles' | 'access' | 'hidScannerEnabled' | 'owner'>>

export async function updateSettings(patch: SettingsPatch): Promise<void> {
  await apiPut('/api/settings', patch)
}
