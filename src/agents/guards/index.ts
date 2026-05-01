/**
 * Agent Guards - Barrel Export
 *
 * Provides three layers of protection for the ReAct agent:
 * 1. CircuitBreaker - per-tool failure tracking and short-circuit
 * 2. ToolCallLimitGuard - total tool call count limit
 * 3. ModelCallLimitGuard - total model call count limit
 */

export { CircuitBreaker } from './circuit-breaker.js';
export type {
  CircuitBreakerConfig,
  CircuitBreakerErrorPayload,
  CircuitBreakerProcessResult,
} from './circuit-breaker.js';

export { ToolCallLimitGuard } from './tool-call-limit.js';
export type {
  ToolCallLimitConfig,
  ToolCallLimitExceededPayload,
  ToolCallLimitResult,
} from './tool-call-limit.js';

export { ModelCallLimitGuard } from './model-call-limit.js';
export type {
  ModelCallLimitConfig,
  ModelCallLimitExceededPayload,
  ModelCallLimitResult,
} from './model-call-limit.js';

// ---------------------------------------------------------------------------
// Unified Guard Config
// ---------------------------------------------------------------------------

/**
 * Configuration for all agent guards.
 * Used by the ReAct agent to initialize the guard system.
 */
export interface GuardConfig {
  /** Whether guards are enabled. */
  enabled: boolean;
  /** Consecutive failure threshold for circuit breaker (per tool). */
  failureThreshold: number;
  /** Maximum total tool calls per request. */
  toolCallLimit: number;
  /** Maximum total model calls per request. */
  modelCallLimit: number;
  /** Message shown when any guard limit is hit. */
  limitMessage: string;
}

// ---------------------------------------------------------------------------
// Guard Suite Factory
// ---------------------------------------------------------------------------

import { CircuitBreaker } from './circuit-breaker.js';
import { ToolCallLimitGuard } from './tool-call-limit.js';
import { ModelCallLimitGuard } from './model-call-limit.js';

export interface GuardSuite {
  circuitBreaker: CircuitBreaker;
  toolCallLimit: ToolCallLimitGuard;
  modelCallLimit: ModelCallLimitGuard;
}

/**
 * Create a configured set of guards from a GuardConfig.
 */
export function createGuardSuite(config: GuardConfig): GuardSuite {
  return {
    circuitBreaker: new CircuitBreaker({
      failureThreshold: config.failureThreshold,
      limitMessage: config.limitMessage,
    }),
    toolCallLimit: new ToolCallLimitGuard({
      limit: config.toolCallLimit,
      limitMessage: config.limitMessage,
    }),
    modelCallLimit: new ModelCallLimitGuard({
      limit: config.modelCallLimit,
      limitMessage: config.limitMessage,
    }),
  };
}
