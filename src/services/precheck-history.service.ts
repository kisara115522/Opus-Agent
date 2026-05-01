/**
 * 预检历史存储服务
 *
 * Ported from Java PrecheckHistoryService.java.
 *
 * Uses JsonFileStore for file-backed persistence of PrecheckResult records.
 * Provides save, getById, getLatest, and addFeedback operations.
 */

import pino from 'pino';
import { JsonFileStore } from '../utils/file.js';
import type {
  PrecheckResult,
  PrecheckFeedbackRequest,
} from '../types/release.js';
import { getConfig } from '../config/index.js';

const logger = pino({ name: 'precheck-history-service' });

// ---------------------------------------------------------------------------
// Store singleton (lazy-initialized on first access)
// ---------------------------------------------------------------------------

let _store: JsonFileStore<PrecheckResult> | undefined;

function getStore(): JsonFileStore<PrecheckResult> {
  if (_store === undefined) {
    const config = getConfig();
    _store = new JsonFileStore<PrecheckResult>(
      config.release.precheck.historyFile,
    );
  }
  return _store;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a precheck result to history.
 * If a result with the same ID already exists, it is replaced.
 * New results are prepended (newest first) to match Java behavior.
 */
export async function save(result: PrecheckResult): Promise<PrecheckResult> {
  const store = getStore();
  const records = await store.load();
  const filtered = records.filter((r) => r.id !== result.id);
  filtered.unshift(result);
  await store.save(filtered);
  logger.info(
    {
      id: result.id,
      service: result.serviceName,
      score: result.riskScore,
    },
    '预检结果已保存',
  );
  return result;
}

/**
 * Get a precheck result by its ID, or null if not found.
 */
export async function getById(id: string): Promise<PrecheckResult | null> {
  return getStore().getById(id);
}

/**
 * Get the most recent precheck results (newest first).
 */
export async function getLatest(limit: number = 10): Promise<PrecheckResult[]> {
  const records = await getStore().load();
  const safeLimit = Math.max(1, limit);
  return records.slice(0, safeLimit);
}

/**
 * Add post-release feedback to an existing precheck result.
 * Updates status to "FEEDBACKED" and appends incident note to summary if applicable.
 * The updated result is moved to the front (newest first).
 * Returns the updated result, or null if the ID was not found.
 */
export async function addFeedback(
  id: string,
  feedback: PrecheckFeedbackRequest,
): Promise<PrecheckResult | null> {
  const store = getStore();
  const existing = await store.getById(id);
  if (existing === null) {
    return null;
  }

  existing.feedback = feedback;
  existing.status = 'FEEDBACKED';
  existing.updatedAt = new Date().toISOString();

  if (feedback.incidentOccurred === true) {
    existing.summary =
      existing.summary +
      ' 发布后回填显示发生故障，建议调整规则权重并补充观测项。';
  }

  // Move to front (newest first), matching Java saveFeedback behavior
  const records = await store.load();
  const filtered = records.filter((r) => r.id !== id);
  filtered.unshift(existing);
  await store.save(filtered);

  logger.info({ id }, '预检反馈已保存');
  return existing;
}
