/**
 * Unit tests for ChatService
 *
 * Covers: buildSystemPrompt (empty and populated history), session creation,
 * synchronous chat execution, streaming chat execution, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppConfig } from '../../src/config/index.js';
import type { LLMProvider } from '../../src/providers/types.js';
import type { HistoryMessage } from '../../src/types/chat.js';
import type { ReactAgentResult, ReactAgentStreamResult } from '../../src/agents/react-agent.js';

// ---------------------------------------------------------------------------
// Mock the react-agent module
// ---------------------------------------------------------------------------

const mockRun = vi.fn();
const mockRunStream = vi.fn();
const mockCreateReactAgent = vi.fn();

vi.mock('../../src/agents/react-agent.js', () => ({
  createReactAgent: (...args: unknown[]) => mockCreateReactAgent(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import {
  buildSystemPrompt,
  createChatSession,
  executeChat,
  executeChatStream,
} from '../../src/services/chat.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    server: { port: 3000 },
    llm: {
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
    },
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'test-key',
    },
    milvus: {
      host: 'localhost',
      port: 19530,
      username: '',
      password: '',
      database: 'default',
      timeout: 10000,
    },
    rag: { topK: 3, model: 'gpt-4o' },
    prometheus: {
      baseUrl: 'http://localhost:9090',
      timeout: 10,
      mockEnabled: false,
    },
    cls: { mockEnabled: false },
    agent: {
      guard: {
        enabled: false,
        failureThreshold: 3,
        toolCallLimit: 12,
        modelCallLimit: 25,
        limitMessage: 'Limit reached',
      },
    },
    release: {
      precheck: {
        enabled: false,
        defaultTimeout: 900000,
        historyFile: '/tmp/history.json',
        weightAuditFile: '/tmp/weights.json',
        scoreWeights: {
          production: 15,
          peakWindow: 10,
          emergency: 20,
          databaseChange: 15,
          configChange: 8,
          largeChange: 12,
          activeAlerts: 20,
          missingRunbook: 15,
          recentIncident: 10,
          missingDeploymentHistory: 8,
        },
        requiredEvidence: {
          deploymentHistory: true,
          serviceBaseline: true,
          rollbackRunbook: true,
        },
      },
    },
    code: {
      review: {
        enabled: false,
        defaultTimeout: 900000,
        commandTimeoutSeconds: 20,
        historyFile: '/tmp/review.json',
        maxCommits: 30,
        maxFiles: 200,
        maxPatchCharsPerFile: 12000,
        blockScore: 65,
        ragEvidenceEnabled: false,
        ragQueriesPerReview: 3,
        agentEnabled: false,
        agentMaxFiles: 8,
        agentMaxPatchCharsPerFile: 4000,
        requireAllowedRoots: false,
        allowedRoots: ['.'],
      },
    },
    document: { chunk: { maxSize: 800, overlap: 100 } },
    file: {
      upload: { path: './uploads', allowedExtensions: ['txt', 'md'] },
    },
    ...overrides,
  } as AppConfig;
}

function makeProvider(overrides?: Partial<LLMProvider>): LLMProvider {
  return {
    name: 'openai',
    chatModel: vi.fn().mockReturnValue({} as never),
    isAvailable: vi.fn().mockReturnValue(true),
    ...overrides,
  } as LLMProvider;
}

function makeAgent(): { run: typeof mockRun; runStream: typeof mockRunStream } {
  return { run: mockRun, runStream: mockRunStream };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateReactAgent.mockReturnValue(makeAgent());
  });

  // =========================================================================
  // buildSystemPrompt
  // =========================================================================

  describe('buildSystemPrompt', () => {
    it('should return base prompt with closing instruction when history is empty', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).toContain('你是一个专业的智能助手');
      expect(prompt).toContain('请基于以上对话历史，回答用户的新问题。');
      // Should NOT contain history markers
      expect(prompt).not.toContain('--- 对话历史 ---');
      expect(prompt).not.toContain('--- 对话历史结束 ---');
    });

    it('should return base prompt when history is explicitly an empty array', () => {
      const prompt = buildSystemPrompt([]);

      expect(prompt).toContain('你是一个专业的智能助手');
      expect(prompt).not.toContain('--- 对话历史 ---');
    });

    it('should inject conversation history when provided', () => {
      const history: HistoryMessage[] = [
        { role: 'user', content: 'What is the weather?' },
        { role: 'assistant', content: 'It is sunny today.' },
      ];

      const prompt = buildSystemPrompt(history);

      expect(prompt).toContain('--- 对话历史 ---');
      expect(prompt).toContain('用户: What is the weather?');
      expect(prompt).toContain('助手: It is sunny today.');
      expect(prompt).toContain('--- 对话历史结束 ---');
    });

    it('should handle multiple conversation turns', () => {
      const history: HistoryMessage[] = [
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Second question' },
        { role: 'assistant', content: 'Second answer' },
      ];

      const prompt = buildSystemPrompt(history);

      expect(prompt).toContain('用户: First question');
      expect(prompt).toContain('助手: First answer');
      expect(prompt).toContain('用户: Second question');
      expect(prompt).toContain('助手: Second answer');
    });

    it('should always end with closing instruction regardless of history', () => {
      const history: HistoryMessage[] = [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ];

      const prompt = buildSystemPrompt(history);
      const lines = prompt.split('\n');
      const lastNonEmpty = lines.filter(Boolean).pop();

      expect(lastNonEmpty).toBe('请基于以上对话历史，回答用户的新问题。');
    });

    it('should contain the base tool instructions', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).toContain('getCurrentDateTime');
      expect(prompt).toContain('queryInternalDocs');
      expect(prompt).toContain('queryPrometheusAlerts');
      expect(prompt).toContain('TOOL_RETRY_LIMIT_EXCEEDED');
    });
  });

  // =========================================================================
  // createChatSession
  // =========================================================================

  describe('createChatSession', () => {
    it('should create a session with the correct model and provider', () => {
      const provider = makeProvider({ name: 'anthropic' });
      const config = makeConfig({ llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'key' } as AppConfig['llm'] });
      const tools = {};

      const session = createChatSession(provider, tools, config);

      expect(session.modelId).toBe('claude-sonnet-4-20250514');
      expect(session.providerName).toBe('anthropic');
      expect(session.createdAt).toBeGreaterThan(0);
      expect(session.agent).toBeDefined();
    });

    it('should pass the system prompt built from history to createReactAgent', () => {
      const provider = makeProvider();
      const config = makeConfig();
      const tools = {};
      const history: HistoryMessage[] = [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ];

      createChatSession(provider, tools, config, history);

      expect(mockCreateReactAgent).toHaveBeenCalledOnce();
      const agentConfig = mockCreateReactAgent.mock.calls[0][0];
      expect(agentConfig.systemPrompt).toContain('用户: Previous question');
      expect(agentConfig.systemPrompt).toContain('助手: Previous answer');
    });

    it('should pass provider, tools, and guard config to createReactAgent', () => {
      const provider = makeProvider();
      const tools = { myTool: { description: 'test', parameters: {} } } as Record<string, never>;
      const config = makeConfig({
        agent: {
          guard: {
            enabled: true,
            failureThreshold: 5,
            toolCallLimit: 10,
            modelCallLimit: 20,
            limitMessage: 'Too many calls',
          },
        },
      });

      createChatSession(provider, tools, config);

      const agentConfig = mockCreateReactAgent.mock.calls[0][0];
      expect(agentConfig.provider).toBe(provider);
      expect(agentConfig.tools).toBe(tools);
      expect(agentConfig.guards).toEqual(config.agent.guard);
      expect(agentConfig.name).toBe('intelligent_assistant');
    });

    it('should create session with empty history by default', () => {
      const provider = makeProvider();
      const config = makeConfig();

      createChatSession(provider, {}, config);

      const agentConfig = mockCreateReactAgent.mock.calls[0][0];
      expect(agentConfig.systemPrompt).not.toContain('--- 对话历史 ---');
    });
  });

  // =========================================================================
  // executeChat
  // =========================================================================

  describe('executeChat', () => {
    it('should call agent.run with the question and return the result', async () => {
      const expectedResult: ReactAgentResult = {
        text: 'The answer is 42.',
        stepCount: 1,
        toolCallCount: 0,
        guardTriggered: false,
        stoppedByGuard: false,
      };
      mockRun.mockResolvedValue(expectedResult);

      const session = {
        agent: makeAgent(),
        modelId: 'gpt-4o',
        providerName: 'openai',
        createdAt: Date.now(),
      };

      const result = await executeChat(session, 'What is the answer?');

      expect(mockRun).toHaveBeenCalledWith('What is the answer?');
      expect(result).toBe(expectedResult);
      expect(result.text).toBe('The answer is 42.');
    });

    it('should propagate errors from agent.run', async () => {
      mockRun.mockRejectedValue(new Error('LLM provider unavailable'));

      const session = {
        agent: makeAgent(),
        modelId: 'gpt-4o',
        providerName: 'openai',
        createdAt: Date.now(),
      };

      await expect(executeChat(session, 'Hello')).rejects.toThrow(
        'LLM provider unavailable',
      );
    });

    it('should propagate non-Error throws from agent.run', async () => {
      mockRun.mockRejectedValue('raw string error');

      const session = {
        agent: makeAgent(),
        modelId: 'gpt-4o',
        providerName: 'openai',
        createdAt: Date.now(),
      };

      await expect(executeChat(session, 'Hello')).rejects.toBe('raw string error');
    });

    it('should return result with tool call and guard metadata', async () => {
      const expectedResult: ReactAgentResult = {
        text: 'Used tools to find the answer.',
        stepCount: 3,
        toolCallCount: 2,
        guardTriggered: true,
        stoppedByGuard: true,
      };
      mockRun.mockResolvedValue(expectedResult);

      const session = {
        agent: makeAgent(),
        modelId: 'gpt-4o',
        providerName: 'openai',
        createdAt: Date.now(),
      };

      const result = await executeChat(session, 'Complex question');

      expect(result.stepCount).toBe(3);
      expect(result.toolCallCount).toBe(2);
      expect(result.guardTriggered).toBe(true);
      expect(result.stoppedByGuard).toBe(true);
    });
  });

  // =========================================================================
  // executeChatStream
  // =========================================================================

  describe('executeChatStream', () => {
    it('should call agent.runStream with the question and return the stream result', async () => {
      const mockStream = { text: Promise.resolve('streamed text') };
      const expectedStats = Promise.resolve({
        stepCount: 1,
        toolCallCount: 0,
        guardTriggered: false,
        stoppedByGuard: false,
      });
      const expectedResult: ReactAgentStreamResult = {
        stream: mockStream as never,
        stats: expectedStats,
      };
      mockRunStream.mockResolvedValue(expectedResult);

      const session = {
        agent: makeAgent(),
        modelId: 'gpt-4o',
        providerName: 'openai',
        createdAt: Date.now(),
      };

      const result = await executeChatStream(session, 'Stream this');

      expect(mockRunStream).toHaveBeenCalledWith('Stream this');
      expect(result).toBe(expectedResult);
      expect(result.stream).toBe(mockStream);
    });

    it('should propagate errors from agent.runStream', async () => {
      mockRunStream.mockRejectedValue(new Error('Stream failed'));

      const session = {
        agent: makeAgent(),
        modelId: 'gpt-4o',
        providerName: 'openai',
        createdAt: Date.now(),
      };

      await expect(executeChatStream(session, 'Hello')).rejects.toThrow(
        'Stream failed',
      );
    });
  });
});
