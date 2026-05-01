/**
 * Tool Failure Circuit Breaker Guard
 *
 * Ports the Java ToolFailureCircuitBreakerInterceptor logic.
 * Tracks consecutive failures per tool name within a single request lifecycle.
 * After reaching the failure threshold for a tool, short-circuits further calls
 * to that tool with a structured error response.
 *
 * Failure detection:
 * 1. JSON responses with `success: false` or `status: error/failed/fail`
 * 2. Keyword matching (timeout, connection refused, etc.)
 * 3. Null/empty results
 */

import pino from 'pino';

const logger = pino({ name: 'circuit-breaker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before short-circuiting (default: 3). */
  failureThreshold: number;
  /** Message shown when the circuit trips. */
  limitMessage: string;
}

export interface CircuitBreakerErrorPayload {
  success: false;
  status: 'error';
  code: 'TOOL_RETRY_LIMIT_EXCEEDED' | 'TOOL_CALL_FAILED';
  tool: string;
  failureCount: number;
  threshold?: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAILURE_KEYWORDS: readonly string[] = [
  'tool failed',
  '查询失败',
  '连接失败',
  'timeout',
  'connection refused',
  '尚未实现',
];

const DEFAULT_LIMIT_MESSAGE =
  '达到重试上限，工具无法调用，请停止继续调用该工具并基于已有证据给出结论。';

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly limitMessage: string;
  private readonly consecutiveFailures = new Map<string, number>();

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    const threshold = config.failureThreshold ?? 3;
    if (threshold <= 0) {
      throw new Error('failureThreshold must be > 0');
    }
    this.failureThreshold = threshold;
    this.limitMessage =
      config.limitMessage && config.limitMessage.trim().length > 0
        ? config.limitMessage
        : DEFAULT_LIMIT_MESSAGE;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Get the current consecutive failure count for a tool.
   */
  getFailureCount(toolName: string): number {
    return this.consecutiveFailures.get(toolName) ?? 0;
  }

  /**
   * Check whether the circuit is tripped for a given tool.
   */
  isTripped(toolName: string): boolean {
    return this.getFailureCount(toolName) >= this.failureThreshold;
  }

  /**
   * Check if a tool result string represents a failure.
   *
   * Detection rules (in order):
   * 1. Null, undefined, or blank string -> failure
   * 2. JSON with `success: false` -> failure
   * 3. JSON with `status: "error" | "failed" | "fail"` -> failure
   * 4. Contains any of the FAILURE_KEYWORDS (case-insensitive) -> failure
   */
  isFailureResult(result: string | null | undefined): boolean {
    if (result === null || result === undefined || result.trim().length === 0) {
      return true;
    }

    const trimmed = result.trim();

    // Try JSON parsing
    try {
      const root: unknown = JSON.parse(trimmed);
      if (typeof root === 'object' && root !== null) {
        const obj = root as Record<string, unknown>;

        if ('success' in obj && obj.success === false) {
          return true;
        }

        if ('status' in obj && typeof obj.status === 'string') {
          const status = obj.status.toLowerCase();
          if (
            status === 'error' ||
            status === 'failed' ||
            status === 'fail'
          ) {
            return true;
          }
        }
      }
    } catch {
      // Not JSON, continue with keyword check
    }

    // Keyword matching
    const lower = trimmed.toLowerCase();
    for (const keyword of FAILURE_KEYWORDS) {
      if (lower.includes(keyword.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Process a tool call result through the circuit breaker.
   *
   * @param toolName - The name of the tool that was called.
   * @param result - The string result from the tool execution.
   * @returns An object indicating whether the call should proceed and optionally a wrapped result.
   */
  processResult(
    toolName: string,
    result: string,
  ): CircuitBreakerProcessResult {
    // If already tripped, short-circuit
    if (this.isTripped(toolName)) {
      logger.warn({ tool: toolName }, 'GUARD_SHORT_CIRCUIT');
      return {
        allowed: false,
        payload: this.buildLimitExceededPayload(toolName),
      };
    }

    // Check if result is a failure
    if (this.isFailureResult(result)) {
      const failCount = this.incrementFailure(toolName);
      logger.warn({ tool: toolName, count: failCount }, 'GUARD_FAIL_COUNT');

      if (failCount >= this.failureThreshold) {
        logger.warn(
          { tool: toolName, threshold: this.failureThreshold },
          'GUARD_TRIP',
        );
        return {
          allowed: false,
          payload: this.buildLimitExceededPayload(toolName),
        };
      }

      return { allowed: true, failureCount: failCount };
    }

    // Success: reset failure counter
    this.consecutiveFailures.delete(toolName);
    return { allowed: true };
  }

  /**
   * Record an exception-based failure (tool threw an error).
   */
  processException(
    toolName: string,
    errorMessage: string | null,
  ): CircuitBreakerProcessResult {
    const failCount = this.incrementFailure(toolName);
    logger.warn({ tool: toolName, count: failCount }, 'GUARD_FAIL_COUNT');

    if (failCount >= this.failureThreshold) {
      logger.warn(
        { tool: toolName, threshold: this.failureThreshold },
        'GUARD_TRIP',
      );
      return {
        allowed: false,
        payload: this.buildLimitExceededPayload(toolName),
      };
    }

    return {
      allowed: true,
      failureCount: failCount,
      payload: this.buildToolFailedPayload(toolName, errorMessage, failCount),
    };
  }

  /**
   * Reset all failure counters (typically called at the start of a new request).
   */
  reset(): void {
    this.consecutiveFailures.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private incrementFailure(toolName: string): number {
    const current = this.consecutiveFailures.get(toolName) ?? 0;
    const next = current + 1;
    this.consecutiveFailures.set(toolName, next);
    return next;
  }

  private buildLimitExceededPayload(toolName: string): CircuitBreakerErrorPayload {
    const failCount = this.consecutiveFailures.get(toolName) ?? 0;
    return {
      success: false,
      status: 'error',
      code: 'TOOL_RETRY_LIMIT_EXCEEDED',
      tool: toolName,
      failureCount: failCount,
      threshold: this.failureThreshold,
      message: this.limitMessage,
    };
  }

  private buildToolFailedPayload(
    toolName: string,
    reason: string | null,
    failCount: number,
  ): CircuitBreakerErrorPayload {
    return {
      success: false,
      status: 'error',
      code: 'TOOL_CALL_FAILED',
      tool: toolName,
      failureCount: failCount,
      message: reason && reason.trim().length > 0 ? reason : 'Tool failed',
    };
  }
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface CircuitBreakerProcessResult {
  /** Whether the tool call should be allowed to proceed (or is short-circuited). */
  allowed: boolean;
  /** The current failure count after processing (only present on failure). */
  failureCount?: number;
  /** Structured error payload to return (when short-circuited or failed). */
  payload?: CircuitBreakerErrorPayload;
}
