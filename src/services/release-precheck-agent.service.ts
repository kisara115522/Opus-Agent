/**
 * Release Precheck Agent Service - ported from Java ReleasePrecheckAgentService.java
 *
 * Orchestrates release precheck evidence collection using the
 * Planner / Executor / Reporter pattern.
 *
 * - Planner: generates step list based on request context
 * - Executor: iterates steps, calls tools to collect evidence
 * - Reporter: summarizes findings
 */

import pino from 'pino';
import type { Tool } from 'ai';
import type { ReleasePrecheckRequest } from '../types/release.js';
import type { ReleaseEvidence, ReleaseAgentExecutionResult } from '../types/evidence.js';

const logger = pino({ name: 'release-precheck-agent-service' });

// ---------------------------------------------------------------------------
// Tool result types (matching tool output shapes)
// ---------------------------------------------------------------------------

interface PrometheusAlertsOutput {
  success: boolean;
  alerts: Array<{ alert_name: string }>;
  message: string;
  error?: string;
}

interface InternalDocsResult {
  content?: string;
  text?: string;
  document?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Doc probe helper
// ---------------------------------------------------------------------------

interface DocProbe {
  keywordHit: boolean;
  evidence: string;
}

// ---------------------------------------------------------------------------
// Progress callback type
// ---------------------------------------------------------------------------

export type ProgressCallback = (message: string) => void;

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReleasePrecheckAgentDeps {
  /** queryPrometheusAlerts tool */
  queryMetricsTool: Tool;
  /** queryInternalDocs tool */
  internalDocsTool: Tool;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReleasePrecheckAgentService {
  private readonly queryMetricsTool: Tool;
  private readonly internalDocsTool: Tool;

  constructor(deps: ReleasePrecheckAgentDeps) {
    this.queryMetricsTool = deps.queryMetricsTool;
    this.internalDocsTool = deps.internalDocsTool;
  }

  /**
   * Execute the release precheck agent pipeline.
   */
  async execute(
    request: ReleasePrecheckRequest,
    progress?: ProgressCallback,
  ): Promise<ReleaseAgentExecutionResult> {
    const evidence: ReleaseEvidence = this.createEmptyEvidence();
    const plannerSteps: string[] = [];
    const executorLogs: string[] = [];

    // Planner
    this.emit(progress, 'Planner: 生成发布预检执行计划...');
    const steps = this.plannerAgent(request);
    plannerSteps.push(...steps);
    evidence.evidenceChain.push(`Planner 计划: ${steps.join(' -> ')}`);

    // Executor
    this.emit(progress, 'Executor: 开始逐步采集证据...');
    for (const step of steps) {
      await this.executeStep(step, request, evidence, executorLogs, progress);
    }

    // Reporter
    this.emit(progress, 'Reporter: 汇总 Agent 证据结论...');
    const reporterSummary = this.reporterAgent(request, evidence, plannerSteps);
    if (reporterSummary) {
      evidence.evidenceChain.push(`Reporter 结论: ${reporterSummary}`);
    }

    return {
      evidence,
      plannerSteps,
      executorLogs,
      reporterSummary,
    };
  }

  // -------------------------------------------------------------------------
  // Planner
  // -------------------------------------------------------------------------

  private plannerAgent(request: ReleasePrecheckRequest): string[] {
    const steps: string[] = [
      'queryDeploymentHistory',
      'queryServiceBaseline',
      'queryRollbackRunbook',
      'queryRecentIncidents',
    ];

    if (request.emergencyRelease) {
      steps.push('queryEmergencyReleaseChecklist');
    }

    return steps;
  }

  // -------------------------------------------------------------------------
  // Executor
  // -------------------------------------------------------------------------

  private async executeStep(
    step: string,
    request: ReleasePrecheckRequest,
    evidence: ReleaseEvidence,
    executorLogs: string[],
    progress?: ProgressCallback,
  ): Promise<void> {
    try {
      switch (step) {
        case 'queryDeploymentHistory': {
          const detail = this.buildDeploymentHistoryEvidence(request);
          evidence.deploymentHistoryAvailable = !detail.includes('未提供提交列表');
          evidence.deploymentHistoryEvidence = detail;
          evidence.evidenceChain.push(`发布历史证据: ${detail}`);
          executorLogs.push('queryDeploymentHistory SUCCESS');
          break;
        }

        case 'queryServiceBaseline': {
          await this.collectServiceBaseline(evidence);
          executorLogs.push('queryServiceBaseline SUCCESS');
          break;
        }

        case 'queryRollbackRunbook': {
          const query = `${request.serviceName} 回滚 runbook SOP 发布失败处理`;
          const probe = await this.queryDocs(query, '回滚', 'rollback', 'sop');
          evidence.rollbackRunbookFound = probe.keywordHit;
          evidence.rollbackRunbookEvidence = probe.evidence;
          evidence.evidenceChain.push(
            `${probe.keywordHit ? '回滚手册证据: ' : '回滚手册证据不足: '}${probe.evidence}`,
          );
          executorLogs.push(`queryRollbackRunbook ${probe.keywordHit ? 'SUCCESS' : 'PARTIAL'}`);
          break;
        }

        case 'queryRecentIncidents': {
          const query = `${request.serviceName} 发布 失败 复盘 事故`;
          const probe = await this.queryDocs(query, '故障', '失败', '事故', '回滚');
          evidence.recentIncidentFound = probe.keywordHit;
          evidence.recentIncidentEvidence = probe.evidence;
          evidence.evidenceChain.push(
            `${probe.keywordHit ? '历史故障证据: ' : '历史故障证据不足: '}${probe.evidence}`,
          );
          executorLogs.push(`queryRecentIncidents ${probe.keywordHit ? 'SUCCESS' : 'PARTIAL'}`);
          break;
        }

        case 'queryEmergencyReleaseChecklist': {
          const emergencyMsg = '紧急发布模式：建议双人复核 + 5分钟粒度观测 + 预置回滚命令。';
          evidence.evidenceChain.push(`紧急发布检查: ${emergencyMsg}`);
          executorLogs.push('queryEmergencyReleaseChecklist SUCCESS');
          break;
        }

        default:
          executorLogs.push(`${step} SKIPPED`);
          break;
      }

      this.emit(progress, `Executor: ${step} 已完成`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      executorLogs.push(`${step} FAILED`);
      evidence.evidenceChain.push(`Agent 执行失败: ${step} 失败: ${message}`);
      this.emit(progress, `Executor: ${step} 失败: ${message}`);
      logger.warn({ step, error: message }, '发布预检 Agent 步骤执行失败');
    }
  }

  // -------------------------------------------------------------------------
  // Reporter
  // -------------------------------------------------------------------------

  private reporterAgent(
    request: ReleasePrecheckRequest,
    evidence: ReleaseEvidence,
    plannerSteps: string[],
  ): string {
    const alertStatus = evidence.activeAlerts
      ? `存在 ${evidence.activeAlertCount} 条活跃告警`
      : '未发现活跃告警';

    const runbookStatus = evidence.rollbackRunbookFound ? '已命中回滚手册' : '回滚手册证据不足';

    return `服务 ${request.serviceName} 预检 Agent 完成，Planner 步骤 ${plannerSteps.length} 个，${alertStatus}，${runbookStatus}。`;
  }

  // -------------------------------------------------------------------------
  // Evidence collection helpers
  // -------------------------------------------------------------------------

  private buildDeploymentHistoryEvidence(request: ReleasePrecheckRequest): string {
    if (!request.changeItems || request.changeItems.length === 0) {
      return '未提供提交列表，无法评估历史发布失败率。';
    }

    const samples = request.changeItems
      .slice(0, 3)
      .map(
        (item) =>
          `${item.commitId || 'unknown'}(${this.truncate(item.title || '无标题', 30)})`,
      );

    return `提交数=${request.changeItems.length}，样例: ${samples.join(', ')}`;
  }

  private async collectServiceBaseline(evidence: ReleaseEvidence): Promise<void> {
    const raw = await this.callTool(this.queryMetricsTool);
    const output = this.parseJson<PrometheusAlertsOutput>(raw);

    if (!output.success) {
      const message = output.message || 'Prometheus 返回失败状态';
      evidence.activeAlerts = false;
      evidence.activeAlertCount = 0;
      evidence.activeAlertEvidence = message;
      evidence.evidenceChain.push(`服务基线证据不足: ${message}`);
      return;
    }

    const alertCount = output.alerts?.length ?? 0;
    evidence.activeAlerts = alertCount > 0;
    evidence.activeAlertCount = alertCount;

    if (alertCount === 0) {
      evidence.activeAlertEvidence = '当前未检测到活跃告警。';
      evidence.evidenceChain.push('服务基线证据: 当前无活跃告警。');
      return;
    }

    const alertNames = (output.alerts ?? [])
      .slice(0, 3)
      .map((a) => a.alert_name || 'unknown-alert');

    evidence.activeAlertEvidence = `检测到 ${alertCount} 条活跃告警，样例: ${alertNames.join(', ')}`;
    evidence.evidenceChain.push(`服务基线证据: ${evidence.activeAlertEvidence}`);
  }

  private async queryDocs(query: string, ...keywords: string[]): Promise<DocProbe> {
    try {
      const raw = await this.callTool(this.internalDocsTool, { query });

      if (!raw) {
        return { keywordHit: false, evidence: '文档检索返回空内容。' };
      }

      const parsed = this.parseJson<InternalDocsResult[] | { status?: string; message?: string }>(raw);

      // Handle no-results response
      if (!Array.isArray(parsed) && parsed.status?.toLowerCase() === 'no_results') {
        return {
          keywordHit: false,
          evidence: (parsed as { message?: string }).message || '未检索到相关文档。',
        };
      }

      // Handle array results
      if (Array.isArray(parsed) && parsed.length > 0) {
        const snippets = parsed
          .slice(0, 2)
          .map((item) => this.firstNonBlank(item.content, item.text, item.document, item.title));

        const merged = snippets.join(' | ');
        const truncated = this.truncate(merged, 220);
        return {
          keywordHit: this.containsKeywords(truncated, keywords),
          evidence: truncated,
        };
      }

      // Handle string result
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const truncated = this.truncate(text, 220);
      return {
        keywordHit: this.containsKeywords(truncated, keywords),
        evidence: truncated,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { keywordHit: false, evidence: `文档检索失败: ${message}` };
    }
  }

  // -------------------------------------------------------------------------
  // Tool calling helpers
  // -------------------------------------------------------------------------

  private async callTool(toolObj: Tool, args?: Record<string, unknown>): Promise<unknown> {
    if (!toolObj.execute) {
      throw new Error(`Tool has no execute function`);
    }
    // The Tool.execute signature from ai SDK takes (args, options)
    // We call it directly for programmatic use
    return toolObj.execute(args ?? {} as Record<string, unknown>, { toolCallId: 'direct', messages: [] });
  }

  private parseJson<T>(raw: unknown): T {
    if (typeof raw === 'string') {
      return JSON.parse(raw) as T;
    }
    return raw as T;
  }

  // -------------------------------------------------------------------------
  // Utility helpers
  // -------------------------------------------------------------------------

  private createEmptyEvidence(): ReleaseEvidence {
    return {
      activeAlerts: false,
      activeAlertCount: 0,
      activeAlertEvidence: '',
      rollbackRunbookFound: false,
      rollbackRunbookEvidence: '',
      deploymentHistoryAvailable: false,
      deploymentHistoryEvidence: '',
      recentIncidentFound: false,
      recentIncidentEvidence: '',
      evidenceChain: [],
    };
  }

  private emit(progress: ProgressCallback | undefined, message: string): void {
    if (progress) {
      progress(message);
    }
  }

  private containsKeywords(text: string, keywords: string[]): boolean {
    const source = text.toLowerCase();
    return keywords.some((keyword) => source.includes(keyword.toLowerCase()));
  }

  private firstNonBlank(...values: Array<string | undefined>): string {
    for (const value of values) {
      if (value?.trim()) return value;
    }
    return '';
  }

  private truncate(input: string | undefined, limit: number): string {
    if (!input) return '';
    if (input.length <= limit) return input;
    return input.substring(0, Math.max(0, limit - 3)) + '...';
  }
}
