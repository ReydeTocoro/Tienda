export type UsuarioRole = 'admin' | 'cajero'

export interface Usuario {
  id: string
  name: string
  role: UsuarioRole
  /** SHA-256 hash of this user's own PIN — same length as `settings.pinLength`. */
  pinHash: string
  active: boolean
  createdAt: string
}
