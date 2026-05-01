/**
 * Code Review History Service - ported from Java CodeReviewHistoryService.java
 *
 * In-memory store with file persistence for code review results.
 * Loads history from disk on startup, persists on every save.
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import pino from 'pino';
import type { CodeReviewResult } from '../types/review.js';

const logger = pino({ name: 'review-history-service' });

/** Maximum number of records kept in memory. */
const MAX_RECORDS = 500;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReviewHistoryService {
  private readonly store = new Map<string, CodeReviewResult>();
  private readonly order: string[] = [];
  private readonly historyFilePath: string;
  private loaded = false;

  constructor(historyFilePath: string) {
    this.historyFilePath = historyFilePath;
  }

  /**
   * Save a code review result. Updates existing entry if ID already exists.
   */
  async save(result: CodeReviewResult): Promise<CodeReviewResult> {
    await this.ensureLoaded();

    this.store.set(result.id, result);

    // Move to front of order (newest first)
    const existingIndex = this.order.indexOf(result.id);
    if (existingIndex !== -1) {
      this.order.splice(existingIndex, 1);
    }
    this.order.unshift(result.id);

    // Enforce max records limit
    this.evict();

    await this.persistToDisk();

    logger.info(
      { id: result.id, projectPath: result.projectPath, riskScore: result.riskScore },
      'Code review result saved',
    );

    return result;
  }

  /**
   * Get a code review result by ID.
   */
  async getById(id: string): Promise<CodeReviewResult | null> {
    await this.ensureLoaded();
    return this.store.get(id) ?? null;
  }

  /**
   * Get the most recent code review results.
   */
  async latest(limit: number): Promise<CodeReviewResult[]> {
    await this.ensureLoaded();

    const results: CodeReviewResult[] = [];
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
  // Private: Eviction
  // -------------------------------------------------------------------------

  /**
   * Evict oldest records when exceeding MAX_RECORDS.
   */
  private evict(): void {
    while (this.order.length > MAX_RECORDS) {
      const removedId = this.order.pop();
      if (removedId) {
        this.store.delete(removedId);
      }
    }
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
      const loaded = JSON.parse(content) as CodeReviewResult[];

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
        'Code review history loaded',
      );
    } catch (err: unknown) {
      // File not found is expected on first run
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug({ path: this.historyFilePath }, 'Code review history file not found, starting empty');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ path: this.historyFilePath, error: message }, 'Code review history load failed');
    }
  }

  /**
   * Persist current state to disk using atomic write (write to temp, then rename).
   */
  private async persistToDisk(): Promise<void> {
    if (!this.historyFilePath) return;

    try {
      const dir = dirname(this.historyFilePath);
      await mkdir(dir, { recursive: true });

      const data = this.order
        .map((id) => this.store.get(id))
        .filter((item): item is CodeReviewResult => item !== undefined);

      // Atomic write: write to temp file, then rename
      const tmpPath = `${this.historyFilePath}.tmp.${Date.now()}`;
      await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      await rename(tmpPath, this.historyFilePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ path: this.historyFilePath, error: message }, 'Code review history persist failed');
    }
  }
}
