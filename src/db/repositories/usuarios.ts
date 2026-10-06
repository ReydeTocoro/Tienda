import { db } from '../index'
import type { Usuario, UsuarioRole } from '../../types/usuario'
import { apiPost, apiPut, apiDelete } from '../../api/client'

export interface UsuarioInput {
  name: string
  role: UsuarioRole
  /** The new PIN as typed — sent once over HTTPS, hashed by the server, never readable again.
   * Omitted on update to keep the existing PIN. */
  pin?: string
  active: boolean
}

export async function listUsuarios(): Promise<Usuario[]> {
  return db.usuarios.toArray()
}

/** The server refuses a PIN or a name someone else already has, and a role that doesn't exist
 * (server/domain/users.ts) — the error message says which. */
export async function addUsuario(input: UsuarioInput & { pin: string }): Promise<Usuario> {
  return apiPost<Usuario>('/api/usuarios', input)
}

export async function updateUsuario(id: string, input: UsuarioInput): Promise<void> {
  await apiPut(`/api/usuarios/${encodeURIComponent(id)}`, input)
}

export async function deleteUsuario(id: string): Promise<void> {
  await apiDelete(`/api/usuarios/${encodeURIComponent(id)}`)
}
