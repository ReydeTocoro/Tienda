import type { AccessSettings, Role } from '../shared/lib/permissions'

/** Business details printed on receipts (Configuración → Negocio). All optional. */
export interface BusinessInfo {
  nit?: string
  phone?: string
  address?: string
  /** Closing line of every receipt; "¡Gracias por su compra!" when empty. */
  receiptFooter?: string
}

/** The owner's own details, edited in Configuración → Usuarios → Propietario. Both optional. */
export interface OwnerProfile {
  /** Shown (and signed on sales and cierres) instead of the name on their `staff` row. */
  name?: string
  /** A small square picture (a JPEG data URL, see src/shared/lib/photo.ts). */
  photo?: string
}

export interface Settings {
  key: 'main'
  storeName: string
  business?: BusinessInfo
  /** Digits of every PIN in the store (the PIN pad submits itself at this length). The PINs themselves
   * are hashed in a database table no device can read (private.pins). */
  pinLength: 4 | 6
  pinChangedAt?: string
  theme: 'dark' | 'light'
  lastCajero?: string
  /** Cash left in the Caja Menor drawer after each close (the "base" for the next day). */
  cajaBase?: number
  hidScannerEnabled: boolean
  /** Editable roles (everything but the fixed Administrador). Absent = the defaults. Read it through
   * `resolveRoles()`, never directly. */
  roles?: Role[]
  /** How sessions behave (closing after inactivity). Read it through `sanitizeAccess()`. */
  access?: AccessSettings
  /** The owner's name and picture. Absent = the name of their `staff` row (else "Propietario"), no picture. */
  owner?: OwnerProfile
}
