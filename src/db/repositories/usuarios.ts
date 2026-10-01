import { db } from '../index'
import type { Usuario, UsuarioRole } from '../../types/usuario'
import { apiPost, apiPut, apiDelete } from '../../api/client'

export interface UsuarioInput {
  name: string
  role: UsuarioRole
  /** Omitted on update to keep the existing PIN unchanged. */
  pinHash?: string
  active: boolean
}

export async function listUsuarios(): Promise<Usuario[]> {
  return db.usuarios.toArray()
}

export async function addUsuario(input: UsuarioInput & { pinHash: string }): Promise<Usuario> {
  return apiPost<Usuario>('/api/usuarios', input)
}

export async function updateUsuario(id: string, input: UsuarioInput): Promise<void> {
  await apiPut(`/api/usuarios/${encodeURIComponent(id)}`, input)
}

export async function deleteUsuario(id: string): Promise<void> {
  await apiDelete(`/api/usuarios/${encodeURIComponent(id)}`)
}
