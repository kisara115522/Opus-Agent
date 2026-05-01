/**
 * Code Review Agent Service - ported from Java CodeReviewAgentService.java
 *
 * Multi-agent code review using a sequential Planner -> Reviewer -> Judge pipeline.
 * Each agent calls the LLM via Vercel AI SDK generateText and outputs structured JSON.
 */

import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import pino from 'pino';
import type { CodeReviewFinding } from '../types/review.js';

const logger = pino({ name: 'code-review-agent-service' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  agentMaxFiles: number;
  agentMaxPatchCharsPerFile: number;
}

export interface AgentContext {
  projectPath: string;
  baseRef: string;
  headRef: string;
  commitRange: string;
  commits: Array<{ commitId: string; author: string; message: string }>;
  changedFiles: string[];
  patches: Array<{ path: string; patch: string }>;
  ruleFindings: CodeReviewFinding[];
  ragEvidence: string;
}

export interface PlannerOutput {
  focusAreas: string[];
  riskHypotheses: string[];
  reviewOrder: string[];
  notes: string;
}

export interface ReviewerFinding {
  ruleKey: string;
  title: string;
  severity: string;
  scoreImpact: number;
  filePath: string;
  evidence: string;
  recommendation: string;
}

export interface ReviewerOutput {
  findings: ReviewerFinding[];
}

export interface JudgeOutput {
  decision: 'PASS' | 'BLOCK' | 'REVIEW_NEEDED';
  scoreAdjustment: number;
  summary: string;
}

export interface MultiAgentResult {
  success: boolean;
  plannerOutput: string;
  reviewerOutput: string;
  judgeOutput: string;
  findings: CodeReviewFinding[];
  decisionSuggestion: string;
  scoreAdjustment: number;
  summary: string;
  traces: string[];
}

export type ProgressCallback = (message: string) => void;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CodeReviewAgentService {
  private readonly llmProvider: LanguageModel;
  private readonly agentMaxFiles: number;
  private readonly agentMaxPatchCharsPerFile: number;

  constructor(llmProvider: LanguageModel, config: AgentConfig) {
    this.llmProvider = llmProvider;
    this.agentMaxFiles = config.agentMaxFiles;
    this.agentMaxPatchCharsPerFile = config.agentMaxPatchCharsPerFile;
  }

  /**
   * Run the 3-stage multi-agent review pipeline.
   */
  async runMultiAgentReview(
    context: AgentContext,
    ruleFindings: CodeReviewFinding[],
    ragEvidence: string,
    progress?: ProgressCallback,
  ): Promise<MultiAgentResult> {
    const traces: string[] = [];

    try {
      // Truncate patches for agent consumption
      const trimmedPatches = context.patches
        .slice(0, this.agentMaxFiles)
        .map((p) => ({
          path: p.path,
          patch: p.patch.length > this.agentMaxPatchCharsPerFile
            ? p.patch.slice(0, this.agentMaxPatchCharsPerFile) + '\n... (truncated)'
            : p.patch,
        }));

      const trimmedContext = { ...context, patches: trimmedPatches };

      // Step 1: Planner
      this.emit(progress, 'Agent Planner: 分析变更并制定审查计划...');
      const plannerRaw = await this.runPlanner(trimmedContext, ruleFindings, ragEvidence);
      traces.push(`Planner 输出长度: ${plannerRaw.length}`);

      const plannerParsed = this.extractJson<PlannerOutput>(plannerRaw);
      if (!plannerParsed) {
        return this.buildFallback('Planner 输出解析失败', plannerRaw, traces);
      }

      // Step 2: Reviewer
      this.emit(progress, 'Agent Reviewer: 执行深度代码审查...');
      const reviewerRaw = await this.runReviewer(trimmedContext, plannerParsed, ruleFindings, ragEvidence);
      traces.push(`Reviewer 输出长度: ${reviewerRaw.length}`);

      const reviewerParsed = this.extractJson<ReviewerOutput>(reviewerRaw);
      if (!reviewerParsed) {
        return this.buildFallback('Reviewer 输出解析失败', plannerRaw, traces, reviewerRaw);
      }

      // Step 3: Judge
      this.emit(progress, 'Agent Judge: 综合评估并给出最终决策...');
      const judgeRaw = await this.runJudge(trimmedContext, plannerParsed, reviewerParsed, ruleFindings);
      traces.push(`Judge 输出长度: ${judgeRaw.length}`);

      const judgeParsed = this.extractJson<JudgeOutput>(judgeRaw);
      if (!judgeParsed) {
        return this.buildFallback('Judge 输出解析失败', plannerRaw, traces, reviewerRaw, judgeRaw);
      }

      // Map reviewer findings to CodeReviewFinding[]
      const agentFindings: CodeReviewFinding[] = (reviewerParsed.findings ?? []).map((f) => ({
        ruleKey: f.ruleKey || 'agent-finding',
        title: f.title || 'Agent 发现',
        severity: f.severity || 'MEDIUM',
        scoreImpact: f.scoreImpact ?? 5,
        filePath: f.filePath || '',
        evidence: f.evidence || '',
        recommendation: f.recommendation || '',
        source: 'agent',
      }));

      // Clamp scoreAdjustment
      const clampedAdjustment = Math.max(-20, Math.min(30, judgeParsed.scoreAdjustment ?? 0));

      return {
        success: true,
        plannerOutput: plannerRaw,
        reviewerOutput: reviewerRaw,
        judgeOutput: judgeRaw,
        findings: agentFindings,
        decisionSuggestion: judgeParsed.decision || 'PASS',
        scoreAdjustment: clampedAdjustment,
        summary: judgeParsed.summary || '',
        traces,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, '多 Agent 代码审查执行失败');
      traces.push(`Agent 异常: ${message}`);
      return this.buildFallback(`Agent 执行异常: ${message}`, '', traces);
    }
  }

  // -------------------------------------------------------------------------
  // Agent 1: Planner
  // -------------------------------------------------------------------------

  private async runPlanner(
    context: AgentContext,
    ruleFindings: CodeReviewFinding[],
    ragEvidence: string,
  ): Promise<string> {
    const systemPrompt = [
      '你是一个代码审查 Planner Agent。',
      '你的任务是分析代码变更的上下文，制定审查重点和计划。',
      '',
      '请输出 JSON，格式如下：',
      '{',
      '  "focusAreas": ["重点审查区域1", "重点审查区域2"],',
      '  "riskHypotheses": ["风险假设1", "风险假设2"],',
      '  "reviewOrder": ["文件路径1", "文件路径2"],',
      '  "notes": "补充说明"',
      '}',
      '',
      '只输出 JSON，不要有其他内容。',
    ].join('\n');

    const userPrompt = this.buildPlannerUserPrompt(context, ruleFindings, ragEvidence);

    const result = await generateText({
      model: this.llmProvider,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.2,
      maxTokens: 2000,
    });

    return result.text;
  }

  private buildPlannerUserPrompt(
    context: AgentContext,
    ruleFindings: CodeReviewFinding[],
    ragEvidence: string,
  ): string {
    const parts: string[] = [];

    parts.push(`## 项目: ${context.projectPath}`);
    parts.push(`## 变更区间: ${context.commitRange}`);
    parts.push(`## 提交数: ${context.commits.length}`);
    parts.push(`## 变更文件数: ${context.changedFiles.length}`);
    parts.push('');

    parts.push('## 提交列表');
    for (const c of context.commits.slice(0, 10)) {
      parts.push(`- ${c.commitId}: ${c.message}`);
    }
    parts.push('');

    parts.push('## 变更文件');
    for (const f of context.changedFiles.slice(0, this.agentMaxFiles)) {
      parts.push(`- ${f}`);
    }
    parts.push('');

    if (ruleFindings.length > 0) {
      parts.push('## 规则引擎已发现的风险');
      for (const f of ruleFindings) {
        parts.push(`- [${f.severity}] ${f.title} (${f.ruleKey}) - ${f.filePath}`);
      }
      parts.push('');
    }

    if (ragEvidence) {
      parts.push('## RAG 历史事故证据');
      parts.push(ragEvidence);
      parts.push('');
    }

    return parts.join('\n');
  }

  // -------------------------------------------------------------------------
  // Agent 2: Reviewer
  // -------------------------------------------------------------------------

  private async runReviewer(
    context: AgentContext,
    planner: PlannerOutput,
    ruleFindings: CodeReviewFinding[],
    ragEvidence: string,
  ): Promise<string> {
    const systemPrompt = [
      '你是一个代码审查 Reviewer Agent。',
      '你的任务是根据 Planner 的审查计划，对代码变更进行深度审查。',
      '',
      '请输出 JSON，格式如下：',
      '{',
      '  "findings": [',
      '    {',
      '      "ruleKey": "规则标识",',
      '      "title": "发现标题",',
      '      "severity": "CRITICAL|HIGH|MEDIUM|LOW",',
      '      "scoreImpact": 5,',
      '      "filePath": "文件路径",',
      '      "evidence": "具体证据",',
      '      "recommendation": "修复建议"',
      '    }',
      '  ]',
      '}',
      '',
      '只输出 JSON，不要有其他内容。',
    ].join('\n');

    const userPrompt = this.buildReviewerUserPrompt(context, planner, ruleFindings, ragEvidence);

    const result = await generateText({
      model: this.llmProvider,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.2,
      maxTokens: 4000,
    });

    return result.text;
  }

  private buildReviewerUserPrompt(
    context: AgentContext,
    planner: PlannerOutput,
    ruleFindings: CodeReviewFinding[],
    ragEvidence: string,
  ): string {
    const parts: string[] = [];

    parts.push('## Planner 审查计划');
    parts.push(`- 重点区域: ${planner.focusAreas?.join(', ') || '无'}`);
    parts.push(`- 风险假设: ${planner.riskHypotheses?.join(', ') || '无'}`);
    parts.push(`- 审查顺序: ${planner.reviewOrder?.join(', ') || '无'}`);
    if (planner.notes) {
      parts.push(`- 补充说明: ${planner.notes}`);
    }
    parts.push('');

    parts.push('## 代码变更（Patch 内容）');
    for (const p of context.patches) {
      parts.push(`### 文件: ${p.path}`);
      parts.push('```diff');
      parts.push(p.patch);
      parts.push('```');
      parts.push('');
    }

    if (ruleFindings.length > 0) {
      parts.push('## 规则引擎已有发现（可补充但不要重复）');
      for (const f of ruleFindings) {
        parts.push(`- [${f.severity}] ${f.title} (${f.ruleKey}): ${f.evidence}`);
      }
      parts.push('');
    }

    if (ragEvidence) {
      parts.push('## RAG 历史事故证据');
      parts.push(ragEvidence);
      parts.push('');
    }

    return parts.join('\n');
  }

  // -------------------------------------------------------------------------
  // Agent 3: Judge
  // -------------------------------------------------------------------------

  private async runJudge(
    context: AgentContext,
    planner: PlannerOutput,
    reviewer: ReviewerOutput,
    ruleFindings: CodeReviewFinding[],
  ): Promise<string> {
    const systemPrompt = [
      '你是一个代码审查 Judge Agent。',
      '你的任务是综合 Planner 的分析、Reviewer 的发现以及规则引擎的结果，给出最终审查决策。',
      '',
      '请输出 JSON，格式如下：',
      '{',
      '  "decision": "PASS|BLOCK|REVIEW_NEEDED",',
      '  "scoreAdjustment": 0,',
      '  "summary": "综合评估说明"',
      '}',
      '',
      'scoreAdjustment 范围: -20 到 30。正值表示增加风险分，负值表示降低风险分。',
      'PASS: 变更安全可合入；BLOCK: 存在重大风险需要修复；REVIEW_NEEDED: 需要人工进一步审查。',
      '',
      '只输出 JSON，不要有其他内容。',
    ].join('\n');

    const userPrompt = this.buildJudgeUserPrompt(context, planner, reviewer, ruleFindings);

    const result = await generateText({
      model: this.llmProvider,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.1,
      maxTokens: 1500,
    });

    return result.text;
  }

  private buildJudgeUserPrompt(
    context: AgentContext,
    planner: PlannerOutput,
    reviewer: ReviewerOutput,
    ruleFindings: CodeReviewFinding[],
  ): string {
    const parts: string[] = [];

    parts.push(`## 项目: ${context.projectPath}`);
    parts.push(`## 变更区间: ${context.commitRange}`);
    parts.push(`## 变更文件数: ${context.changedFiles.length}`);
    parts.push('');

    parts.push('## Planner 分析');
    parts.push(`- 重点区域: ${planner.focusAreas?.join(', ') || '无'}`);
    parts.push(`- 风险假设: ${planner.riskHypotheses?.join(', ') || '无'}`);
    parts.push('');

    parts.push('## Reviewer 发现');
    const findings = reviewer.findings ?? [];
    if (findings.length === 0) {
      parts.push('Reviewer 未发现额外风险。');
    } else {
      for (const f of findings) {
        parts.push(
          `- [${f.severity}] ${f.title} (+${f.scoreImpact}分) - ${f.filePath}: ${f.evidence}`,
        );
      }
    }
    parts.push('');

    parts.push('## 规则引擎发现');
    if (ruleFindings.length === 0) {
      parts.push('规则引擎未发现风险。');
    } else {
      for (const f of ruleFindings) {
        parts.push(
          `- [${f.severity}] ${f.title} (+${f.scoreImpact}分) - ${f.filePath}: ${f.evidence}`,
        );
      }
    }

    return parts.join('\n');
  }

  // -------------------------------------------------------------------------
  // JSON extraction helper
  // -------------------------------------------------------------------------

  /**
   * Extract and parse JSON from agent output.
   * Handles responses wrapped in markdown code blocks.
   */
  private extractJson<T>(text: string): T | null {
    if (!text || text.trim() === '') {
      return null;
    }

    // Try direct parse first
    try {
      return JSON.parse(text.trim()) as T;
    } catch {
      // Fall through to extraction
    }

    // Try extracting JSON from markdown code blocks
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim()) as T;
      } catch {
        // Fall through
      }
    }

    // Try extracting the first { ... } block
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]) as T;
      } catch {
        // Fall through
      }
    }

    logger.warn({ textLength: text.length }, '无法从 Agent 输出中解析 JSON');
    return null;
  }

  // -------------------------------------------------------------------------
  // Fallback result builder
  // -------------------------------------------------------------------------

  private buildFallback(
    reason: string,
    plannerOutput: string,
    traces: string[],
    reviewerOutput = '',
    judgeOutput = '',
  ): MultiAgentResult {
    traces.push(`回退: ${reason}`);
    return {
      success: false,
      plannerOutput,
      reviewerOutput,
      judgeOutput,
      findings: [],
      decisionSuggestion: 'REVIEW_NEEDED',
      scoreAdjustment: 0,
      summary: reason,
      traces,
    };
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  private emit(progress: ProgressCallback | undefined, message: string): void {
    if (progress) {
      progress(message);
    }
  }
}
