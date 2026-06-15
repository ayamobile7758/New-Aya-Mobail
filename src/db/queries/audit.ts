import { dbClient } from '../client';
import { nanoid } from 'nanoid';
import { getDeviceId } from '@/lib/device';

export async function logAudit(
  action: string,
  detail?: string,
  refType?: string | null,
  refId?: string | null
): Promise<void> {
  try {
    await dbClient.run(
      `INSERT INTO audit_log (id, ts, action, detail, ref_type, ref_id, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), new Date().toISOString(), action, detail ?? null, refType ?? null, refId ?? null, getDeviceId()]
    );
  } catch (e) {
    // Audit failures must never block business operations
    console.error('[audit] failed to write audit entry:', { action, e });
  }
}

export async function getAuditLog(opts?: {
  from?: string;
  to?: string;
  actions?: string[];
  search?: string;
  deviceId?: string;
  limit?: number;
}): Promise<{
  id: string; ts: string; action: string; detail: string | null;
  ref_type: string | null; ref_id: string | null; device_id: string | null;
}[]> {
  const { from, to, actions, search, deviceId, limit = 500 } = opts ?? {};

  const conditions: string[] = [];
  const params: any[] = [];

  if (from)  { conditions.push("DATE(ts) >= ?"); params.push(from); }
  if (to)    { conditions.push("DATE(ts) <= ?"); params.push(to); }
  if (actions && actions.length > 0) {
    conditions.push(`action IN (${actions.map(() => '?').join(',')})`);
    params.push(...actions);
  }
  if (search)   { conditions.push("detail ILIKE ?"); params.push(`%${search}%`); }
  if (deviceId) { conditions.push("device_id = ?"); params.push(deviceId); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  return dbClient.query(
    `SELECT id, ts, action, detail, ref_type, ref_id, device_id
     FROM audit_log ${where} ORDER BY ts DESC LIMIT ?`,
    params
  );
}

export async function getAuditActions(): Promise<string[]> {
  const rows = await dbClient.query(
    `SELECT DISTINCT action FROM audit_log ORDER BY action`
  );
  return rows.map((r: any) => r.action);
}

export async function getAuditDevices(): Promise<string[]> {
  const rows = await dbClient.query(
    `SELECT DISTINCT device_id FROM audit_log WHERE device_id IS NOT NULL ORDER BY device_id`
  );
  return rows.map((r: any) => r.device_id as string);
}
