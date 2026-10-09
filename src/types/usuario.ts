/** A role id: 'admin', 'supervisor', 'cajero' or a custom role from `settings.roles` (see
 * src/shared/lib/permissions.ts). Rows saved before custom roles existed hold 'admin'/'cajero'. */
export type UsuarioRole = string

export interface Usuario {
  id: string
  name: string
  role: UsuarioRole
  /** The email they sign in with — their own Supabase Auth account, whose password only Supabase
   * keeps (lowercase). Absent on rows saved before each person had an account: they can't sign in
   * until an administrator gives them one. */
  email?: string
  /** A small square picture (a JPEG data URL, see src/shared/lib/photo.ts), shown beside their name. */
  photo?: string
  /* Their PIN (optional) authorizes steps on someone else's session. It's unique (nobody else, nor
   * the owner's master PIN, has it) and lives hashed in a database table no device can read; it's
   * checked by the server only. */
  /** Digits of that PIN, so a later change of `settings.pinLength` can flag who needs a new one.
   * Absent when they have none, or on rows saved before it existed. */
  pinLength?: 4 | 6
  active: boolean
  createdAt: string
}
