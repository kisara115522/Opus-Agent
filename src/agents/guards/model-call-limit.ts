/**
 * Model Call Limit Guard
 *
 * Tracks the total number of model (LLM) calls within a single request lifecycle.
 * After reaching the configured limit, signals that execution should stop.
 *
 * Corresponds to the Java ModelCallLimitHook.
 */

import pino from 'pino';

const logger = pino({ name: 'model-call-limit' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelCallLimitConfig {
  /** Maximum number of model calls allowed per request (default: 25). */
  limit: number;
  /** Message shown when the limit is exceeded. */
  limitMessage: string;
}

export interface ModelCallLimitExceededPayload {
  success: false;
  status: 'error';
  code: 'MODEL_CALL_LIMIT_EXCEEDED';
  modelCallCount: number;
  limit: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 25;
const DEFAULT_LIMIT_MESSAGE =
  '模型调用次数已达上限，请基于已有结果给出结论。';

// ---------------------------------------------------------------------------
// ModelCallLimitGuard
// ---------------------------------------------------------------------------

export class ModelCallLimitGuard {
  private readonly limit: number;
  private readonly limitMessage: string;
  private modelCallCount = 0;

  constructor(config: Partial<ModelCallLimitConfig> = {}) {
    const limit = config.limit ?? DEFAULT_LIMIT;
    if (limit <= 0) {
      throw new Error('model call limit must be > 0');
    }
    this.limit = limit;
    this.limitMessage =
      config.limitMessage && config.limitMessage.trim().length > 0
        ? config.limitMessage
        : DEFAULT_LIMIT_MESSAGE;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Get the current model call count.
   */
  getCount(): number {
    return this.modelCallCount;
  }

  /**
   * Get the configured limit.
   */
  getLimit(): number {
    return this.limit;
  }

  /**
   * Check whether the limit has been reached.
   */
  isLimitReached(): boolean {
    return this.modelCallCount >= this.limit;
  }

  /**
   * Record a model call and check if the limit is exceeded.
   *
   * @returns An object indicating whether the call is allowed.
   */
  recordCall(): ModelCallLimitResult {
    this.modelCallCount++;

    if (this.modelCallCount > this.limit) {
      logger.warn(
        { count: this.modelCallCount, limit: this.limit },
        'MODEL_CALL_LIMIT_EXCEEDED',
      );
      return {
        allowed: false,
        payload: {
          success: false,
          status: 'error',
          code: 'MODEL_CALL_LIMIT_EXCEEDED',
          modelCallCount: this.modelCallCount,
          limit: this.limit,
          message: this.limitMessage,
        },
      };
    }

    return { allowed: true };
  }

  /**
   * Reset the counter (typically called at the start of a new request).
   */
  reset(): void {
    this.modelCallCount = 0;
  }
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ModelCallLimitResult {
  /** Whether the model call is allowed. */
  allowed: boolean;
  /** Structured error payload when the limit is exceeded. */
  payload?: ModelCallLimitExceededPayload;
}
