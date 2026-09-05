export interface Settings {
  key: 'main'
  storeName: string
  pinHash: string
  pinLength: 4 | 6
  pinChangedAt?: string
  theme: 'dark' | 'light'
  lastCajero?: string
  hidScannerEnabled: boolean
  /** Absolute epoch-ms timestamp until which the PIN entry stays locked out. Persists across reloads. */
  pinLockedUntil?: number
}
