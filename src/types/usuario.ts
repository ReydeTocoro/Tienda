/** A role id: 'admin', 'supervisor', 'cajero' or a custom role from `settings.roles` (see
 * src/shared/lib/permissions.ts). Rows saved before custom roles existed hold 'admin'/'cajero'. */
export type UsuarioRole = string

export interface Usuario {
  id: string
  name: string
  role: UsuarioRole
  /* Their own PIN is unique (nobody else, nor the owner's master PIN, has it) and lives hashed in a
   * database table no device can read; it's checked by the server only. */
  /** Digits of that PIN, so a later change of `settings.pinLength` can flag who needs a new one.
   * Absent on rows saved before it existed. */
  pinLength?: 4 | 6
  active: boolean
  createdAt: string
}
