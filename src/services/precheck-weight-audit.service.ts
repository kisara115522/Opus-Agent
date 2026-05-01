/**
 * Precheck Weight Audit Service - ported from Java PrecheckWeightAuditService.java
 *
 * File-persistent audit log for weight changes in release precheck scoring.
 * Records operator, before/after weights, and timestamp.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import pino from 'pino';
import type { ReleaseWeightAuditRecord } from '../types/release.js';

const logger = pino({ name: 'precheck-weight-audit-service' });

const MAX_AUDIT_RECORDS = 1000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PrecheckWeightAuditService {
  private readonly auditFilePath: string;

  constructor(auditFilePath: string) {
    this.auditFilePath = auditFilePath;
  }

  /**
   * Record a weight change event.
   */
  async recordWeightChange(
    operator: string,
    beforeWeights: Record<string, number>,
    updatedWeights: Record<string, number>,
    afterWeights: Record<string, number>,
  ): Promise<void> {
    const record: ReleaseWeightAuditRecord = {
      changedAt: new Date().toISOString(),
      operator: operator?.trim() || 'unknown',
      beforeWeights: { ...beforeWeights },
      updatedWeights: { ...updatedWeights },
      afterWeights: { ...afterWeights },
    };

    const records = await this.readAllRecords();
    records.unshift(record);

    // Trim to max records
    const trimmed = records.length > MAX_AUDIT_RECORDS
      ? records.slice(0, MAX_AUDIT_RECORDS)
      : records;

    await this.persist(trimmed);

    logger.info({ operator: record.operator }, '权重变更已记录');
  }

  /**
   * Get the most recent weight audit records.
   */
  async latest(limit: number): Promise<ReleaseWeightAuditRecord[]> {
    const all = await this.readAllRecords();
    const safeLimit = Math.max(1, limit);
    return all.length <= safeLimit ? all : all.slice(0, safeLimit);
  }

  // -------------------------------------------------------------------------
  // Private: File I/O
  // -------------------------------------------------------------------------

  private async readAllRecords(): Promise<ReleaseWeightAuditRecord[]> {
    if (!this.auditFilePath) return [];

    try {
      const content = await readFile(this.auditFilePath, 'utf-8');
      const loaded = JSON.parse(content) as ReleaseWeightAuditRecord[];
      return Array.isArray(loaded) ? loaded : [];
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ path: this.auditFilePath, error: message }, '读取权重审计日志失败');
      return [];
    }
  }

  private async persist(records: ReleaseWeightAuditRecord[]): Promise<void> {
    if (!this.auditFilePath) return;

    try {
      const dir = dirname(this.auditFilePath);
      await mkdir(dir, { recursive: true });
      await writeFile(this.auditFilePath, JSON.stringify(records, null, 2), 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ path: this.auditFilePath, error: message }, '持久化权重审计日志失败');
    }
  }
}
