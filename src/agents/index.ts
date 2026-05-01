/**
 * Agents - Barrel Export
 *
 * Provides the ReAct agent wrapper and all guard components.
 */

export { ReActAgent, createReactAgent } from './react-agent.js';
export type {
  ReactAgentConfig,
  ReactAgentResult,
  ReactAgentStreamResult,
  ReactAgentStreamStats,
} from './react-agent.js';

export {
  CircuitBreaker,
  ToolCallLimitGuard,
  ModelCallLimitGuard,
  createGuardSuite,
} from './guards/index.js';
export type {
  GuardConfig,
  GuardSuite,
  CircuitBreakerConfig,
  CircuitBreakerErrorPayload,
  CircuitBreakerProcessResult,
  ToolCallLimitConfig,
  ToolCallLimitExceededPayload,
  ToolCallLimitResult,
  ModelCallLimitConfig,
  ModelCallLimitExceededPayload,
  ModelCallLimitResult,
} from './guards/index.js';
