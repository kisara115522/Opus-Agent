/**
 * ReAct Agent Wrapper
 *
 * A reusable agent that wraps Vercel AI SDK's generateText/streamText with
 * integrated guard protection (circuit breaker, tool call limit, model call limit).
 *
 * Design:
 * - Each tool's execute function is wrapped with circuit breaker and tool call
 *   limit checks, so guards are enforced at the tool execution boundary.
 * - maxSteps is set to the model call limit to cap total LLM invocations.
 * - onStepFinish tracks model calls and tool calls for observability.
 *
 * Based on the Java ChatService.createReactAgent() pattern.
 */

import {
  generateText,
  streamText,
  tool,
  type LanguageModel,
  type Tool,
  type ToolSet,
  type ToolExecutionOptions,
  type GenerateTextResult,
  type StreamTextResult,
  type StepResult,
} from 'ai';
import pino from 'pino';
import type { LLMProvider } from '../providers/types.js';
import {
  CircuitBreaker,
  ToolCallLimitGuard,
  ModelCallLimitGuard,
  createGuardSuite,
  type GuardConfig,
  type GuardSuite,
} from './guards/index.js';

const logger = pino({ name: 'react-agent' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReactAgentConfig {
  /** Agent name for logging. */
  name: string;
  /** LLM provider instance. */
  provider: LLMProvider;
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514"). */
  modelId: string;
  /** System prompt for the agent. */
  systemPrompt: string;
  /** Tools available to the agent. */
  tools: Record<string, Tool>;
  /** Guard configuration. If omitted, guards are disabled. */
  guards?: GuardConfig;
  /** Maximum number of steps (LLM calls). Overrides model call limit if guards are disabled. */
  maxSteps?: number;
}

export interface ReactAgentResult {
  /** The final text response from the agent. */
  text: string;
  /** Total number of steps (LLM calls) executed. */
  stepCount: number;
  /** Total number of tool calls made. */
  toolCallCount: number;
  /** Whether any guard was triggered. */
  guardTriggered: boolean;
  /** Whether execution was stopped due to a guard limit. */
  stoppedByGuard: boolean;
  /** The guard suite used (if guards were enabled). */
  guards?: GuardSuite;
}

export interface ReactAgentStreamResult {
  /** The stream result from streamText. */
  stream: StreamTextResult<ToolSet, never>;
  /** The guard suite used (if guards were enabled). */
  guards?: GuardSuite;
  /** Promise that resolves with execution stats when the stream completes. */
  stats: Promise<ReactAgentStreamStats>;
}

export interface ReactAgentStreamStats {
  stepCount: number;
  toolCallCount: number;
  guardTriggered: boolean;
  stoppedByGuard: boolean;
}

// ---------------------------------------------------------------------------
// ReActAgent
// ---------------------------------------------------------------------------

export class ReActAgent {
  private readonly config: ReactAgentConfig;
  private readonly model: LanguageModel;
  private readonly guardSuite: GuardSuite | undefined;

  constructor(config: ReactAgentConfig) {
    this.config = config;
    this.model = config.provider.chatModel(config.modelId);

    if (config.guards?.enabled) {
      this.guardSuite = createGuardSuite(config.guards);
    }
  }

  // -------------------------------------------------------------------------
  // Sync mode
  // -------------------------------------------------------------------------

  /**
   * Execute the agent synchronously using generateText.
   */
  async run(prompt: string): Promise<ReactAgentResult> {
    const { wrappedTools, toolCallCounter } = this.wrapTools();
    const maxSteps = this.resolveMaxSteps();
    let stepCount = 0;
    let guardTriggered = false;

    const result = await generateText({
      model: this.model,
      system: this.config.systemPrompt,
      prompt,
      tools: wrappedTools,
      maxSteps,
      onStepFinish: (stepResult: StepResult<ToolSet>) => {
        stepCount++;
        this.handleStepFinish(stepResult, {
          onGuardTrip: () => {
            guardTriggered = true;
          },
        });
      },
    });

    const stoppedByGuard =
      guardTriggered || this.isGuardLimitReached(toolCallCounter);

    logger.info(
      {
        agent: this.config.name,
        stepCount,
        toolCallCount: toolCallCounter.count,
        guardTriggered,
        stoppedByGuard,
      },
      'ReAct agent completed',
    );

    return {
      text: result.text,
      stepCount,
      toolCallCount: toolCallCounter.count,
      guardTriggered,
      stoppedByGuard,
      guards: this.guardSuite,
    };
  }

  // -------------------------------------------------------------------------
  // Streaming mode
  // -------------------------------------------------------------------------

  /**
   * Execute the agent in streaming mode using streamText.
   */
  async runStream(prompt: string): Promise<ReactAgentStreamResult> {
    const { wrappedTools, toolCallCounter } = this.wrapTools();
    const maxSteps = this.resolveMaxSteps();
    let stepCount = 0;
    let guardTriggered = false;

    const stream = streamText({
      model: this.model,
      system: this.config.systemPrompt,
      prompt,
      tools: wrappedTools,
      maxSteps,
      onStepFinish: (stepResult: StepResult<ToolSet>) => {
        stepCount++;
        this.handleStepFinish(stepResult, {
          onGuardTrip: () => {
            guardTriggered = true;
          },
        });
      },
    });

    const stats: Promise<ReactAgentStreamStats> = (async () => {
      // Wait for the stream to complete to get final stats
      await stream.text;
      const stoppedByGuard =
        guardTriggered || this.isGuardLimitReached(toolCallCounter);

      logger.info(
        {
          agent: this.config.name,
          stepCount,
          toolCallCount: toolCallCounter.count,
          guardTriggered,
          stoppedByGuard,
        },
        'ReAct agent stream completed',
      );

      return {
        stepCount,
        toolCallCount: toolCallCounter.count,
        guardTriggered,
        stoppedByGuard,
      };
    })();

    return {
      stream,
      guards: this.guardSuite,
      stats,
    };
  }

  // -------------------------------------------------------------------------
  // Private: Tool wrapping
  // -------------------------------------------------------------------------

  private wrapTools(): {
    wrappedTools: ToolSet;
    toolCallCounter: { count: number };
  } {
    const toolCallCounter = { count: 0 };
    const originalTools = this.config.tools;
    const wrappedTools: ToolSet = {};

    for (const [name, originalTool] of Object.entries(originalTools)) {
      if (!originalTool.execute) {
        wrappedTools[name] = originalTool;
        continue;
      }

      const originalExecute = originalTool.execute;
      const guardSuite = this.guardSuite;

      wrappedTools[name] = tool({
        description: originalTool.description,
        parameters: originalTool.parameters,
        execute: async (
          args: Record<string, unknown>,
          options: ToolExecutionOptions,
        ) => {
          // Check tool call limit
          if (guardSuite) {
            const toolLimitResult = guardSuite.toolCallLimit.recordCall();
            toolCallCounter.count++;

            if (!toolLimitResult.allowed) {
              logger.warn(
                { tool: name, count: toolCallCounter.count },
                'TOOL_CALL_LIMIT_REACHED',
              );
              return JSON.stringify(toolLimitResult.payload);
            }
          } else {
            toolCallCounter.count++;
          }

          // Check circuit breaker (is it tripped for this tool?)
          if (guardSuite && guardSuite.circuitBreaker.isTripped(name)) {
            const result = guardSuite.circuitBreaker.processResult(name, '');
            logger.warn({ tool: name }, 'CIRCUIT_BREAKER_SHORT_CIRCUIT');
            return JSON.stringify(result.payload);
          }

          // Execute the original tool
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await originalExecute(args as any, options);

            // Convert result to string for circuit breaker analysis
            const resultStr =
              typeof result === 'string' ? result : JSON.stringify(result);

            // Process through circuit breaker
            if (guardSuite) {
              const cbResult = guardSuite.circuitBreaker.processResult(
                name,
                resultStr,
              );
              if (!cbResult.allowed) {
                return JSON.stringify(cbResult.payload);
              }
            }

            return result;
          } catch (error: unknown) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);

            // Process exception through circuit breaker
            if (guardSuite) {
              const cbResult = guardSuite.circuitBreaker.processException(
                name,
                errorMessage,
              );
              if (!cbResult.allowed) {
                return JSON.stringify(cbResult.payload);
              }
              // Return the structured error payload (but circuit not tripped yet)
              return JSON.stringify(cbResult.payload);
            }

            // No guards: re-throw
            throw error;
          }
        },
      });
    }

    return { wrappedTools, toolCallCounter };
  }

  // -------------------------------------------------------------------------
  // Private: Step handling
  // -------------------------------------------------------------------------

  private handleStepFinish(
    stepResult: StepResult<ToolSet>,
    callbacks: { onGuardTrip: () => void },
  ): void {
    // Count model calls
    if (this.guardSuite) {
      const modelResult = this.guardSuite.modelCallLimit.recordCall();
      if (!modelResult.allowed) {
        logger.warn('MODEL_CALL_LIMIT_REACHED');
        callbacks.onGuardTrip();
      }
    }

    // Log step info
    const toolCallCount = stepResult.toolCalls?.length ?? 0;
    const toolResultCount = stepResult.toolResults?.length ?? 0;

    logger.debug(
      {
        agent: this.config.name,
        finishReason: stepResult.finishReason,
        toolCalls: toolCallCount,
        toolResults: toolResultCount,
      },
      'Step finished',
    );
  }

  // -------------------------------------------------------------------------
  // Private: Helpers
  // -------------------------------------------------------------------------

  private resolveMaxSteps(): number {
    // If guards are enabled, use model call limit as maxSteps
    if (this.guardSuite) {
      return this.guardSuite.modelCallLimit.getLimit();
    }
    // Otherwise use explicit maxSteps or a reasonable default
    return this.config.maxSteps ?? 25;
  }

  private isGuardLimitReached(toolCallCounter: { count: number }): boolean {
    if (!this.guardSuite) return false;
    return (
      this.guardSuite.modelCallLimit.isLimitReached() ||
      this.guardSuite.toolCallLimit.isLimitReached()
    );
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create a ReAct agent from configuration.
 */
export function createReactAgent(config: ReactAgentConfig): ReActAgent {
  return new ReActAgent(config);
}
