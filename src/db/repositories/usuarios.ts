import { db } from '../index'
import type { Usuario, UsuarioRole } from '../../types/usuario'
import { apiPost, apiPut, apiDelete } from '../../api/client'

export interface UsuarioInput {
  name: string
  role: UsuarioRole
  /** The email they sign in with. Omitted on update to keep it. */
  email?: string
  /** A new password for their account — sent once over HTTPS, kept only by Supabase Auth. Omitted
   * on update to keep the current one. */
  password?: string
  /** A new PIN to authorize steps — sent once over HTTPS, hashed by the server, never readable
   * again. Omitted to keep (or not have) one. */
  pin?: string
  active: boolean
}

export async function listUsuarios(): Promise<Usuario[]> {
  return db.usuarios.toArray()
}

/** The server refuses an email, a name or a PIN someone else already has, and a role that doesn't
 * exist (server/domain/users.ts) — the error message says which. */
export async function addUsuario(input: UsuarioInput & { email: string }): Promise<Usuario> {
  return apiPost<Usuario>('/api/usuarios', input)
}

export async function updateUsuario(id: string, input: UsuarioInput): Promise<void> {
  await apiPut(`/api/usuarios/${encodeURIComponent(id)}`, input)
}

export async function deleteUsuario(id: string): Promise<void> {
  await apiDelete(`/api/usuarios/${encodeURIComponent(id)}`)
}
