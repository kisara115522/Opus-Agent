/**
 * Unit tests for AiOpsService
 *
 * Covers: successful analysis, error handling, progress callback invocation,
 * result structure for success and failure paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiOpsService } from '../../src/services/ai-ops.service.js';
import type { AiOpsDeps, AiOpsResult } from '../../src/services/ai-ops.service.js';
import type { AppConfig } from '../../src/config/index.js';

// ---------------------------------------------------------------------------
// Mock the 'ai' module
// ---------------------------------------------------------------------------

const mockGenerateText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(): AppConfig {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    LOG_LEVEL: 'silent',
    LLM_PROVIDER: 'openai',
    LLM_MODEL: 'gpt-4o',
    LLM_API_KEY: 'test-key',
    LLM_BASE_URL: 'https://api.openai.com/v1',
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIMENSIONS: 1536,
    VECTOR_STORE_TYPE: 'memory',
    QDRANT_URL: 'http://localhost:6333',
    QDRANT_COLLECTION: 'test',
    REDIS_URL: 'redis://localhost:6379',
    MAX_AGENT_STEPS: 10,
    ALERTMANAGER_URL: 'http://localhost:9093',
    PROMETHEUS_URL: 'http://localhost:9090',
    LOKI_URL: 'http://localhost:3100',
    INTERNAL_DOCS_PATH: '/tmp/docs',
    CHUNK_MAX_SIZE: 800,
    CHUNK_OVERLAP: 100,
  } as unknown as AppConfig;
}

function makeDeps(overrides?: Partial<AiOpsDeps>): AiOpsDeps {
  return {
    llmProvider: {} as AiOpsDeps['llmProvider'],
    tools: {},
    config: makeConfig(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AiOpsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Successful analysis
  // -------------------------------------------------------------------------

  describe('analyze - success', () => {
    it('should return success result with report text', async () => {
      mockGenerateText.mockResolvedValue({
        text: '# Diagnosis Report\nAll systems nominal.',
        steps: [
          { toolCalls: [{ toolName: 'queryPrometheusAlerts' }] },
          { toolCalls: [{ toolName: 'queryLogs' }] },
        ],
      });

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result.success).toBe(true);
      expect(result.report).toBe('# Diagnosis Report\nAll systems nominal.');
      expect(result.stepsExecuted).toBe(2);
      expect(result.toolCalls).toBe(2);
      expect(result.error).toBeUndefined();
    });

    it('should count tool calls across multiple steps', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Report content',
        steps: [
          { toolCalls: [{ toolName: 'toolA' }, { toolName: 'toolB' }] },
          { toolCalls: [{ toolName: 'toolC' }] },
          { toolCalls: [] },
        ],
      });

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result.stepsExecuted).toBe(3);
      expect(result.toolCalls).toBe(3);
    });

    it('should use fallback report text when generateText returns empty text', async () => {
      mockGenerateText.mockResolvedValue({
        text: '',
        steps: [],
      });

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result.success).toBe(true);
      expect(result.report).toBe('分析完成，但未生成报告内容。');
    });

    it('should handle missing steps array in generateText result', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Some report',
        steps: undefined,
      });

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result.success).toBe(true);
      expect(result.stepsExecuted).toBe(0);
      expect(result.toolCalls).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('analyze - error', () => {
    it('should return failure result when generateText throws Error', async () => {
      mockGenerateText.mockRejectedValue(new Error('LLM connection refused'));

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result.success).toBe(false);
      expect(result.report).toBe('');
      expect(result.stepsExecuted).toBe(0);
      expect(result.toolCalls).toBe(0);
      expect(result.error).toBe('LLM connection refused');
    });

    it('should return failure result when generateText throws non-Error', async () => {
      mockGenerateText.mockRejectedValue('string error');

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });

    it('should not throw even when generateText rejects', async () => {
      mockGenerateText.mockRejectedValue(new Error('fatal'));

      const service = new AiOpsService(makeDeps());

      await expect(service.analyze()).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Progress callback
  // -------------------------------------------------------------------------

  describe('progress callback', () => {
    it('should call progress with start message', async () => {
      mockGenerateText.mockResolvedValue({ text: 'Report', steps: [] });

      const progress = vi.fn();
      const service = new AiOpsService(makeDeps());
      await service.analyze(progress);

      expect(progress).toHaveBeenCalledWith(
        expect.stringContaining('正在启动 AIOps 分析'),
      );
    });

    it('should call progress with completion message on success', async () => {
      mockGenerateText.mockResolvedValue({ text: 'Report', steps: [] });

      const progress = vi.fn();
      const service = new AiOpsService(makeDeps());
      await service.analyze(progress);

      expect(progress).toHaveBeenCalledWith(
        expect.stringContaining('分析完成'),
      );
    });

    it('should call progress for each tool call via onStepFinish', async () => {
      // Capture the onStepFinish callback passed to generateText
      mockGenerateText.mockImplementation(async (args: Record<string, unknown>) => {
        const onStepFinish = args.onStepFinish as (event: { toolCalls: { toolName: string }[] }) => void;
        onStepFinish({ toolCalls: [{ toolName: 'queryPrometheusAlerts' }] });
        onStepFinish({ toolCalls: [{ toolName: 'queryLogs' }, { toolName: 'queryInternalDocs' }] });
        return { text: 'Report', steps: [{ toolCalls: [{ toolName: 'queryPrometheusAlerts' }] }, { toolCalls: [{ toolName: 'queryLogs' }, { toolName: 'queryInternalDocs' }] }] };
      });

      const progress = vi.fn();
      const service = new AiOpsService(makeDeps());
      await service.analyze(progress);

      expect(progress).toHaveBeenCalledWith(
        expect.stringContaining('queryPrometheusAlerts'),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.stringContaining('queryLogs'),
      );
      expect(progress).toHaveBeenCalledWith(
        expect.stringContaining('queryInternalDocs'),
      );
    });

    it('should not throw when progress callback is not provided', async () => {
      mockGenerateText.mockImplementation(async (args: Record<string, unknown>) => {
        const onStepFinish = args.onStepFinish as (event: { toolCalls: { toolName: string }[] }) => void;
        onStepFinish({ toolCalls: [{ toolName: 'someTool' }] });
        return { text: 'Report', steps: [] };
      });

      const service = new AiOpsService(makeDeps());

      await expect(service.analyze()).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Result structure
  // -------------------------------------------------------------------------

  describe('result structure', () => {
    it('should always include all required fields on success', async () => {
      mockGenerateText.mockResolvedValue({
        text: 'Report',
        steps: [{ toolCalls: [{ toolName: 'toolA' }] }],
      });

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('report');
      expect(result).toHaveProperty('stepsExecuted');
      expect(result).toHaveProperty('toolCalls');
      expect(result.success).toBe(true);
      expect(typeof result.report).toBe('string');
      expect(typeof result.stepsExecuted).toBe('number');
      expect(typeof result.toolCalls).toBe('number');
    });

    it('should always include all required fields on failure', async () => {
      mockGenerateText.mockRejectedValue(new Error('boom'));

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('report');
      expect(result).toHaveProperty('stepsExecuted');
      expect(result).toHaveProperty('toolCalls');
      expect(result).toHaveProperty('error');
      expect(result.success).toBe(false);
      expect(result.report).toBe('');
      expect(result.stepsExecuted).toBe(0);
      expect(result.toolCalls).toBe(0);
      expect(typeof result.error).toBe('string');
    });

    it('should not have error field on success', async () => {
      mockGenerateText.mockResolvedValue({ text: 'OK', steps: [] });

      const service = new AiOpsService(makeDeps());
      const result = await service.analyze();

      expect(result.error).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // generateText invocation
  // -------------------------------------------------------------------------

  describe('generateText invocation', () => {
    it('should pass llmProvider as model', async () => {
      const llmProvider = { id: 'test-model' } as unknown as AiOpsDeps['llmProvider'];
      mockGenerateText.mockResolvedValue({ text: 'OK', steps: [] });

      const service = new AiOpsService(makeDeps({ llmProvider }));
      await service.analyze();

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ model: llmProvider }),
      );
    });

    it('should pass tools from deps', async () => {
      const tools = { myTool: { description: 'test' } } as unknown as AiOpsDeps['tools'];
      mockGenerateText.mockResolvedValue({ text: 'OK', steps: [] });

      const service = new AiOpsService(makeDeps({ tools }));
      await service.analyze();

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ tools }),
      );
    });

    it('should set maxSteps to 15', async () => {
      mockGenerateText.mockResolvedValue({ text: 'OK', steps: [] });

      const service = new AiOpsService(makeDeps());
      await service.analyze();

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ maxSteps: 15 }),
      );
    });

    it('should set temperature to 0.3', async () => {
      mockGenerateText.mockResolvedValue({ text: 'OK', steps: [] });

      const service = new AiOpsService(makeDeps());
      await service.analyze();

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.3 }),
      );
    });
  });
});
