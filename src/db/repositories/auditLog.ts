import { db } from '../index'
import type { AuditLogEntry } from '../../types/auditLog'

export async function listAuditLog(): Promise<AuditLogEntry[]> {
  return db.auditLog.orderBy('id').reverse().toArray()
}

export async function addAuditEntry(entry: Omit<AuditLogEntry, 'id'>): Promise<void> {
  await db.auditLog.add(entry as AuditLogEntry)
}
