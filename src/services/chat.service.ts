/**
 * Chat Service
 *
 * Ported from Java ChatService.java.
 *
 * Provides the core chat orchestration logic:
 * - System prompt construction with conversation history injection
 * - ReAct agent session creation with tool and guard wiring
 * - Synchronous and streaming chat execution
 *
 * Design:
 * - Provider-agnostic: accepts any LLMProvider via the providers registry
 * - Tools are passed in as a Record<string, Tool>, keeping the service
 *   decoupled from tool construction details
 * - Guard configuration is read from AppConfig.agent.guard
 */

import type { Tool, ToolSet } from 'ai';
import pino from 'pino';
import type { AppConfig } from '../config/index.js';
import type { LLMProvider } from '../providers/types.js';
import { ReActAgent, createReactAgent } from '../agents/react-agent.js';
import type { ReactAgentConfig, ReactAgentResult, ReactAgentStreamResult } from '../agents/react-agent.js';
import type { GuardConfig } from '../agents/guards/index.js';
import type { HistoryMessage } from '../types/chat.js';

const logger = pino({ name: 'chat-service' });

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Base system prompt text, preserving the Java ChatService wording.
 * Translated to Chinese comments per WORK_RULES.md §6.
 */
const BASE_SYSTEM_PROMPT = `你是一个专业的智能助手，可以获取当前时间、查询天气信息、搜索内部文档知识库，以及查询 Prometheus 告警信息。
当用户询问时间相关问题时，使用 getCurrentDateTime 工具。
当用户需要查询公司内部文档、流程、最佳实践或技术指南时，使用 queryInternalDocs 工具。
当用户需要查询 Prometheus 告警、监控指标或系统告警状态时，使用 queryPrometheusAlerts 工具。
当用户需要查询腾讯云日志时，请调用腾讯云mcp服务查询,默认查询地域ap-guangzhou,查询时间范围为近一个月。

如果工具返回 TOOL_RETRY_LIMIT_EXCEEDED 或包含"达到重试上限"，禁止再次调用该工具。
遇到该限制时请明确说明对应数据源当前不可用，并基于已有证据给出结论。`;

/**
 * Build the full system prompt, optionally injecting conversation history.
 *
 * Mirrors the Java ChatService.buildSystemPrompt() logic:
 * 1. Append base instructions
 * 2. If history is non-empty, inject a "--- 对话历史 ---" block
 * 3. Append closing instruction
 *
 * @param history - Previous conversation messages (user + assistant pairs)
 * @returns Complete system prompt string
 */
export function buildSystemPrompt(history: HistoryMessage[] = []): string {
  const parts: string[] = [BASE_SYSTEM_PROMPT];

  if (history.length > 0) {
    parts.push('\n--- 对话历史 ---');
    for (const msg of history) {
      const prefix = msg.role === 'user' ? '用户' : '助手';
      parts.push(`${prefix}: ${msg.content}`);
    }
    parts.push('--- 对话历史结束 ---\n');
  }

  parts.push('请基于以上对话历史，回答用户的新问题。');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Chat session
// ---------------------------------------------------------------------------

/**
 * A chat session wraps a ReActAgent instance with its configuration metadata.
 * Returned by `createChatSession` and consumed by `executeChat` / `executeChatStream`.
 */
export interface ChatSession {
  /** The underlying ReAct agent. */
  agent: ReActAgent;
  /** The model id used for this session. */
  modelId: string;
  /** The provider name used for this session. */
  providerName: string;
  /** Session creation timestamp (epoch millis). */
  createdAt: number;
}

/**
 * Create a new chat session with a ReAct agent.
 *
 * Mirrors Java ChatService.createReactAgent():
 * - Wires the provider + model + system prompt + tools + guards into a ReActAgent
 *
 * @param provider  - LLM provider (from ProviderRegistry)
 * @param tools     - Tool set available to the agent
 * @param config    - Application config (for guard settings and model selection)
 * @param history   - Optional conversation history to inject into the system prompt
 * @returns A ChatSession wrapping the configured agent
 */
export function createChatSession(
  provider: LLMProvider,
  tools: Record<string, Tool>,
  config: AppConfig,
  history: HistoryMessage[] = [],
): ChatSession {
  const systemPrompt = buildSystemPrompt(history);
  const modelId = config.llm.model;

  const agentConfig: ReactAgentConfig = {
    name: 'intelligent_assistant',
    provider,
    modelId,
    systemPrompt,
    tools,
    // Zod schema guarantees all fields are present at runtime;
    // the optional-marker in the inferred type is a Zod artefact.
    guards: config.agent.guard as GuardConfig,
  };

  const agent = createReactAgent(agentConfig);

  logger.info(
    { provider: provider.name, modelId, toolCount: Object.keys(tools).length },
    'Chat session created',
  );

  return {
    agent,
    modelId,
    providerName: provider.name,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Chat execution
// ---------------------------------------------------------------------------

/**
 * Execute a synchronous chat request.
 *
 * Mirrors Java ChatService.executeChat():
 * - Calls agent.run(question) and returns the text response
 *
 * @param session  - Chat session created by createChatSession
 * @param question - User's question
 * @returns The agent's text response
 * @throws Propagates any agent or provider errors
 */
export async function executeChat(
  session: ChatSession,
  question: string,
): Promise<ReactAgentResult> {
  logger.info({ question }, 'Executing synchronous chat');
  const result = await session.agent.run(question);
  logger.info(
    {
      answerLength: result.text.length,
      stepCount: result.stepCount,
      toolCallCount: result.toolCallCount,
      guardTriggered: result.guardTriggered,
    },
    'Synchronous chat completed',
  );
  return result;
}

/**
 * Execute a streaming chat request.
 *
 * Returns a stream result that can be consumed by an SSE handler.
 * The `stats` promise resolves when the stream completes with execution metrics.
 *
 * @param session  - Chat session created by createChatSession
 * @param question - User's question
 * @returns Stream result with the text stream and stats promise
 */
export async function executeChatStream(
  session: ChatSession,
  question: string,
): Promise<ReactAgentStreamResult> {
  logger.info({ question }, 'Executing streaming chat');
  const result = await session.agent.runStream(question);
  logger.info('Streaming chat started');
  return result;
}
