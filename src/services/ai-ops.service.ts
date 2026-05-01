/**
 * AIOps Service - Intelligent Operations Analysis
 *
 * Single-agent loop using Vercel AI SDK's generateText with maxSteps.
 * Replaces Java's Supervisor-Planner-Executor multi-agent pattern.
 *
 * The agent automatically:
 * 1. Queries active Prometheus alerts
 * 2. Searches logs for correlated evidence
 * 3. Retrieves runbooks from internal docs (RAG)
 * 4. Generates a structured diagnosis report
 */

import { generateText, type LanguageModel, type Tool } from 'ai';
import pino from 'pino';
import type { AppConfig } from '../config/index.js';

const logger = pino({ name: 'ai-ops-service' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiOpsDeps {
  llmProvider: LanguageModel;
  tools: Record<string, Tool>;
  config: AppConfig;
}

export interface AiOpsResult {
  success: boolean;
  report: string;
  stepsExecuted: number;
  toolCalls: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const AI_OPS_SYSTEM_PROMPT = `你是企业级 SRE AI 助手，负责自动排查告警并生成诊断报告。

## 工作流程

1. **查询告警**：调用 queryPrometheusAlerts 获取当前活跃告警
2. **分析日志**：针对每个告警，调用 queryLogs 查询相关日志证据
3. **查阅文档**：调用 queryInternalDocs 获取运维手册和处置方案
4. **生成报告**：综合所有证据，输出结构化分析报告

## 报告格式（decision=FINISH 时输出）

# 告警分析报告

## 📋 活跃告警清单

| 告警名称 | 级别 | 目标服务 | 持续时间 | 状态 |
|---------|------|----------|---------|------|
| ... | ... | ... | ... | 活跃 |

## 🔍 告警分析

### [告警名称]
- **症状**：根据监控指标描述
- **日志证据**：引用关键日志
- **根因**：基于证据的结论

## 🛠️ 处理建议
1. 具体操作步骤
2. 验证方法

## 📊 风险评估
- 当前风险等级
- 影响范围

## 规则
- 只使用工具返回的真实数据，严禁编造
- 工具失败时如实记录，不要跳过
- 证据充分时立即输出报告，不要多余轮次
- 如果没有活跃告警，直接说明并给出系统健康状态总结`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AiOpsService {
  private readonly llmProvider: LanguageModel;
  private readonly tools: Record<string, Tool>;
  private readonly config: AppConfig;

  constructor(deps: AiOpsDeps) {
    this.llmProvider = deps.llmProvider;
    this.tools = deps.tools;
    this.config = deps.config;
  }

  /**
   * Execute AIOps analysis using a single agent loop.
   */
  async analyze(progress?: (msg: string) => void): Promise<AiOpsResult> {
    logger.info('开始 AIOps 自动分析');
    progress?.('🔍 正在启动 AIOps 分析...\n');

    try {
      const result = await generateText({
        model: this.llmProvider,
        system: AI_OPS_SYSTEM_PROMPT,
        prompt: '请立即开始告警排查。先查询当前活跃告警，然后逐步分析每个告警的根因，最后生成完整的诊断报告。',
        tools: this.tools,
        maxSteps: 15,
        temperature: 0.3,
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls) {
            for (const tc of toolCalls) {
              progress?.(`🔧 调用工具: ${tc.toolName}\n`);
            }
          }
        },
      });

      const report = result.text || '分析完成，但未生成报告内容。';
      const toolCallCount = result.steps?.reduce(
        (sum, step) => sum + (step.toolCalls?.length ?? 0), 0,
      ) ?? 0;

      progress?.('\n✅ 分析完成\n');

      logger.info(
        { steps: result.steps?.length, toolCalls: toolCallCount },
        'AIOps 分析完成',
      );

      return {
        success: true,
        report,
        stepsExecuted: result.steps?.length ?? 0,
        toolCalls: toolCallCount,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'AIOps 分析失败');

      return {
        success: false,
        report: '',
        stepsExecuted: 0,
        toolCalls: 0,
        error: message,
      };
    }
  }
}
