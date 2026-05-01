/**
 * Tool Call Limit Guard
 *
 * Tracks the total number of tool calls within a single request lifecycle.
 * After reaching the configured limit, rejects further tool calls with
 * a structured error message.
 *
 * Corresponds to the Java ToolCallLimitHook.
 */

import pino from 'pino';

const logger = pino({ name: 'tool-call-limit' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCallLimitConfig {
  /** Maximum number of tool calls allowed per request (default: 12). */
  limit: number;
  /** Message shown when the limit is exceeded. */
  limitMessage: string;
}

export interface ToolCallLimitExceededPayload {
  success: false;
  status: 'error';
  code: 'TOOL_CALL_LIMIT_EXCEEDED';
  toolCallCount: number;
  limit: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 12;
const DEFAULT_LIMIT_MESSAGE =
  '工具调用次数已达上限，请基于已有结果给出结论。';

// ---------------------------------------------------------------------------
// ToolCallLimitGuard
// ---------------------------------------------------------------------------

export class ToolCallLimitGuard {
  private readonly limit: number;
  private readonly limitMessage: string;
  private toolCallCount = 0;

  constructor(config: Partial<ToolCallLimitConfig> = {}) {
    const limit = config.limit ?? DEFAULT_LIMIT;
    if (limit <= 0) {
      throw new Error('tool call limit must be > 0');
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
   * Get the current tool call count.
   */
  getCount(): number {
    return this.toolCallCount;
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
    return this.toolCallCount >= this.limit;
  }

  /**
   * Record a tool call and check if the limit is exceeded.
   *
   * @returns An object indicating whether the call is allowed.
   */
  recordCall(): ToolCallLimitResult {
    this.toolCallCount++;

    if (this.toolCallCount > this.limit) {
      logger.warn(
        { count: this.toolCallCount, limit: this.limit },
        'TOOL_CALL_LIMIT_EXCEEDED',
      );
      return {
        allowed: false,
        payload: {
          success: false,
          status: 'error',
          code: 'TOOL_CALL_LIMIT_EXCEEDED',
          toolCallCount: this.toolCallCount,
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
    this.toolCallCount = 0;
  }
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface ToolCallLimitResult {
  /** Whether the tool call is allowed. */
  allowed: boolean;
  /** Structured error payload when the limit is exceeded. */
  payload?: ToolCallLimitExceededPayload;
}
