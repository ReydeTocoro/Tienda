import { db } from '../index'
import type { AuditLogEntry } from '../../types/auditLog'
import { apiPost } from '../../api/client'

export async function listAuditLog(): Promise<AuditLogEntry[]> {
  return db.auditLog.orderBy('id').reverse().toArray()
}

export async function addAuditEntry(entry: Omit<AuditLogEntry, 'id'>): Promise<void> {
  await apiPost('/api/auditLog', entry)
}
