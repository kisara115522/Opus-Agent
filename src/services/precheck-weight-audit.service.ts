/**
 * 发布预检权重变更审计服务
 *
 * Ported from Java PrecheckWeightAuditService.java.
 *
 * Records weight configuration changes for auditability.
 * Uses JsonFileStore for file-backed persistence.
 * New records are prepended (newest first). Caps at 1000 records.
 */

import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { JsonFileStore } from '../utils/file.js';
import type { ReleaseWeightAuditRecord } from '../types/release.js';
import { getConfig } from '../config/index.js';

const logger = pino({ name: 'precheck-weight-audit-service' });

const MAX_AUDIT_RECORDS = 1000;

// ---------------------------------------------------------------------------
// Store singleton (lazy-initialized on first access)
// ---------------------------------------------------------------------------

let _store: JsonFileStore<ReleaseWeightAuditRecord> | undefined;

function getStore(): JsonFileStore<ReleaseWeightAuditRecord> {
  if (_store === undefined) {
    const config = getConfig();
    _store = new JsonFileStore<ReleaseWeightAuditRecord>(
      config.release.precheck.weightAuditFile,
    );
  }
  return _store;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Record a weight configuration change.
 *
 * @param operator - Who made the change (defaults to "unknown")
 * @param beforeWeights - Weight values before the change
 * @param updatedWeights - The delta (changed weights only)
 * @param afterWeights - Full weight values after the change
 */
export async function recordChange(
  operator: string,
  beforeWeights: Record<string, number>,
  updatedWeights: Record<string, number>,
  afterWeights: Record<string, number>,
): Promise<void> {
  const store = getStore();

  const record: ReleaseWeightAuditRecord = {
    id: randomUUID(),
    changedAt: new Date().toISOString(),
    operator: operator == null || operator.trim() === '' ? 'unknown' : operator.trim(),
    beforeWeights: { ...beforeWeights },
    updatedWeights: { ...updatedWeights },
    afterWeights: { ...afterWeights },
  };

  // Prepend new record (newest first), cap at MAX_AUDIT_RECORDS
  const records = await store.load();
  records.unshift(record);
  if (records.length > MAX_AUDIT_RECORDS) {
    records.length = MAX_AUDIT_RECORDS;
  }
  await store.save(records);

  logger.info({ operator: record.operator }, '权重变更已记录');
}

/**
 * Get the most recent weight audit records (newest first).
 *
 * @param limit - Maximum number of records to return (default: 20)
 */
export async function getAuditLog(
  limit: number = 20,
): Promise<ReleaseWeightAuditRecord[]> {
  const records = await getStore().load();
  const safeLimit = Math.max(1, limit);
  return records.slice(0, safeLimit);
}
