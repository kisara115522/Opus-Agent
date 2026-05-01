/**
 * Precheck History Service - ported from Java PrecheckHistoryService.java
 *
 * In-memory store with file persistence for release precheck results.
 * Loads history from disk on startup, persists on every save.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import pino from 'pino';
import type { PrecheckResult, PrecheckFeedbackRequest } from '../types/release.js';

const logger = pino({ name: 'precheck-history-service' });

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PrecheckHistoryService {
  private readonly store = new Map<string, PrecheckResult>();
  private readonly order: string[] = [];
  private readonly historyFilePath: string;
  private loaded = false;

  constructor(historyFilePath: string) {
    this.historyFilePath = historyFilePath;
  }

  /**
   * Save a precheck result. Updates existing entry if ID already exists.
   */
  async save(result: PrecheckResult): Promise<PrecheckResult> {
    await this.ensureLoaded();

    this.store.set(result.id, result);

    // Move to front of order
    const existingIndex = this.order.indexOf(result.id);
    if (existingIndex !== -1) {
      this.order.splice(existingIndex, 1);
    }
    this.order.unshift(result.id);

    await this.persistToDisk();

    logger.info(
      { id: result.id, service: result.serviceName, score: result.riskScore },
      '预检结果已保存',
    );

    return result;
  }

  /**
   * Get a precheck result by ID.
   */
  async getById(id: string): Promise<PrecheckResult | undefined> {
    await this.ensureLoaded();
    return this.store.get(id);
  }

  /**
   * Save feedback for an existing precheck result.
   */
  async saveFeedback(
    id: string,
    feedback: PrecheckFeedbackRequest,
  ): Promise<PrecheckResult | undefined> {
    await this.ensureLoaded();

    const existing = this.store.get(id);
    if (!existing) return undefined;

    existing.feedback = feedback;
    existing.status = 'FEEDBACKED';
    existing.updatedAt = new Date().toISOString();

    if (feedback.incidentOccurred) {
      existing.summary =
        existing.summary + ' 发布后回填显示发生故障，建议调整规则权重并补充观测项。';
    }

    await this.save(existing);
    return existing;
  }

  /**
   * Get the most recent precheck results.
   */
  async latest(limit: number): Promise<PrecheckResult[]> {
    await this.ensureLoaded();

    const results: PrecheckResult[] = [];
    const safeLimit = Math.max(1, limit);

    for (let i = 0; i < this.order.length && i < safeLimit; i++) {
      const item = this.store.get(this.order[i]);
      if (item) {
        results.push(item);
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Private: Persistence
  // -------------------------------------------------------------------------

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await this.loadFromDisk();
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.historyFilePath) return;

    try {
      const content = await readFile(this.historyFilePath, 'utf-8');
      const loaded = JSON.parse(content) as PrecheckResult[];

      this.store.clear();
      this.order.length = 0;

      if (Array.isArray(loaded)) {
        for (const item of loaded) {
          if (!item?.id) continue;
          this.store.set(item.id, item);
          this.order.push(item.id);
        }
      }

      logger.info(
        { path: this.historyFilePath, count: this.store.size },
        '发布预检历史加载完成',
      );
    } catch (err: unknown) {
      // File not found is expected on first run
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug({ path: this.historyFilePath }, '预检历史文件不存在，跳过加载');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ path: this.historyFilePath, error: message }, '发布预检历史加载失败');
    }
  }

  private async persistToDisk(): Promise<void> {
    if (!this.historyFilePath) return;

    try {
      const dir = dirname(this.historyFilePath);
      await mkdir(dir, { recursive: true });

      const data = this.order
        .map((id) => this.store.get(id))
        .filter((item): item is PrecheckResult => item !== undefined);

      await writeFile(this.historyFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ path: this.historyFilePath, error: message }, '发布预检历史持久化失败');
    }
  }
}
