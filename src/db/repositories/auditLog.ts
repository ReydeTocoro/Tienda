import { db } from '../index'
import type { AuditLogEntry } from '../../types/auditLog'

export async function listAuditLog(): Promise<AuditLogEntry[]> {
  return db.auditLog.orderBy('id').reverse().toArray()
}

