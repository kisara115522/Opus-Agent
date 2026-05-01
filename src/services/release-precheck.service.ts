/**
 * Release Precheck Service - ported from Java ReleasePrecheckService.java
 *
 * Orchestration service for release precheck:
 * validate -> collect evidence (agent) -> risk score -> build report -> save history
 */

import pino from 'pino';
import type { AppConfig } from '../config/index.js';
import type { Tool } from 'ai';
import type {
  ReleasePrecheckRequest,
  PrecheckResult,
  PrecheckFeedbackRequest,
  WatchMetric,
  RollbackStep,
} from '../types/release.js';
import type { ReleaseEvidence, RiskScoreResult } from '../types/evidence.js';
import { RiskScoringService } from './risk-scoring.service.js';
import {
  ReleasePrecheckAgentService,
  type ProgressCallback,
  type ReleasePrecheckAgentDeps,
} from './release-precheck-agent.service.js';
import { ReleaseReportService } from './release-report.service.js';
import { PrecheckHistoryService } from './precheck-history.service.js';

const logger = pino({ name: 'release-precheck-service' });

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReleasePrecheckDeps {
  config: AppConfig;
  queryMetricsTool: Tool;
  internalDocsTool: Tool;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReleasePrecheckService {
  private readonly config: AppConfig;
  private readonly riskScoringService: RiskScoringService;
  private readonly agentService: ReleasePrecheckAgentService;
  private readonly reportService: ReleaseReportService;
  private readonly historyService: PrecheckHistoryService;

  constructor(deps: ReleasePrecheckDeps) {
    this.config = deps.config;

    this.riskScoringService = new RiskScoringService(deps.config);
    this.agentService = new ReleasePrecheckAgentService({
      queryMetricsTool: deps.queryMetricsTool,
      internalDocsTool: deps.internalDocsTool,
    });
    this.reportService = new ReleaseReportService();
    this.historyService = new PrecheckHistoryService(deps.config.release.precheck.historyFile);
  }

  /**
   * Main entry point: run a release precheck.
   */
  async runPrecheck(
    request: ReleasePrecheckRequest,
    progress?: ProgressCallback,
  ): Promise<PrecheckResult> {
    if (!this.config.release.precheck.enabled) {
      throw new Error('发布预检能力未启用，请检查 release.precheck.enabled 配置');
    }

    // Step 0: Validate and normalize
    const normalized = this.normalizeAndValidate(request);

    // Step 1: Collect evidence via agent
    this.emit(progress, '步骤 1/4: 收集发布证据...');
    let evidence: ReleaseEvidence;
    try {
      const agentResult = await this.agentService.execute(normalized, progress);
      evidence = agentResult.evidence;
      if (agentResult.reporterSummary) {
        evidence.evidenceChain.unshift(`AgentReporter: ${agentResult.reporterSummary}`);
      }
    } catch (agentError: unknown) {
      const message = agentError instanceof Error ? agentError.message : String(agentError);
      logger.warn({ error: message }, '发布预检 Agent 编排执行失败，回退到本地证据采集逻辑');
      evidence = await this.collectEvidence(normalized, progress);
    }

    // Step 2: Risk scoring
    this.emit(progress, '步骤 2/4: 执行规则评分...');
    const scoreResult = this.riskScoringService.score(normalized, evidence);

    // Step 3: Build result with watch metrics and rollback plan
    this.emit(progress, '步骤 3/4: 生成观测指标与回滚预案...');
    const now = new Date().toISOString();
    const result: PrecheckResult = {
      id: crypto.randomUUID(),
      serviceName: normalized.serviceName,
      environment: normalized.environment,
      changeSummary: normalized.changeSummary,
      releaseWindow: normalized.releaseWindow,
      riskScore: scoreResult.riskScore,
      riskLevel: scoreResult.riskLevel,
      riskFactors: scoreResult.riskFactors,
      releaseStrategy: scoreResult.releaseStrategy,
      watchMetrics: this.buildWatchMetrics(scoreResult, evidence),
      rollbackPlan: this.buildRollbackPlan(evidence),
      decision: scoreResult.decision,
      summary: '',
      evidenceChain: evidence.evidenceChain,
      reportMarkdown: '',
      status: 'PRECHECKED',
      feedback: null,
      createdAt: now,
      updatedAt: now,
    };

    // Step 4: Build report
    this.emit(progress, '步骤 4/4: 组装《发布变更预检报告》...');
    result.summary = this.reportService.buildSummary(result, evidence);
    result.reportMarkdown = this.reportService.buildMarkdown(result, evidence);

    // Save history
    await this.historyService.save(result);
    this.emit(progress, `预检完成，ID: ${result.id}`);

    return result;
  }

  /**
   * Get a precheck result by ID.
   */
  async getPrecheckById(id: string): Promise<PrecheckResult | undefined> {
    return this.historyService.getById(id);
  }

  /**
   * Save feedback for an existing precheck.
   */
  async saveFeedback(
    id: string,
    feedback: PrecheckFeedbackRequest,
  ): Promise<PrecheckResult | undefined> {
    return this.historyService.saveFeedback(id, feedback);
  }

  /**
   * List recent precheck results.
   */
  async latest(limit: number): Promise<PrecheckResult[]> {
    return this.historyService.latest(limit);
  }

  // -------------------------------------------------------------------------
  // Private: Validation
  // -------------------------------------------------------------------------

  private normalizeAndValidate(request: ReleasePrecheckRequest): ReleasePrecheckRequest {
    if (!request) {
      throw new Error('请求体不能为空');
    }
    if (!request.serviceName?.trim()) {
      throw new Error('serviceName 不能为空');
    }
    if (!request.environment?.trim()) {
      throw new Error('environment 不能为空');
    }
    if (!request.changeSummary?.trim()) {
      throw new Error('changeSummary 不能为空');
    }

    return {
      serviceName: request.serviceName.trim(),
      environment: request.environment.trim(),
      changeSummary: request.changeSummary.trim(),
      releaseWindow: request.releaseWindow?.trim() || '未提供',
      operator: request.operator?.trim() || 'unknown',
      emergencyRelease: request.emergencyRelease ?? false,
      changeItems: request.changeItems ?? [],
    };
  }

  // -------------------------------------------------------------------------
  // Private: Fallback evidence collection (when agent fails)
  // -------------------------------------------------------------------------

  private async collectEvidence(
    request: ReleasePrecheckRequest,
    progress?: ProgressCallback,
  ): Promise<ReleaseEvidence> {
    const evidence = this.createEmptyEvidence();

    // Deployment evidence
    this.collectDeploymentEvidence(request, evidence);
    this.emit(progress, '已采集变更规模证据');

    // Metrics evidence
    await this.collectMetricsEvidence(evidence);
    this.emit(progress, '已采集服务健康基线证据');

    // Runbook evidence
    await this.collectRunbookEvidence(request, evidence);
    this.emit(progress, '已采集回滚手册证据');

    // Incident evidence
    await this.collectIncidentEvidence(request, evidence);
    this.emit(progress, '已采集历史故障证据');

    // Required evidence status
    this.appendRequiredEvidenceStatus(evidence);

    return evidence;
  }

  private collectDeploymentEvidence(
    request: ReleasePrecheckRequest,
    evidence: ReleaseEvidence,
  ): void {
    const items = request.changeItems;
    if (!items || items.length === 0) {
      evidence.deploymentHistoryAvailable = false;
      evidence.deploymentHistoryEvidence = '未提供提交列表，无法评估历史发布失败率。';
      evidence.evidenceChain.push('发布历史证据不足: 未提供提交列表。');
      return;
    }

    const commitSnapshot = items
      .slice(0, 3)
      .map((item) => {
        const commit = item.commitId || 'unknown';
        const title = this.truncate(item.title || '无标题', 30);
        return `${commit}(${title})`;
      })
      .join(', ');

    evidence.deploymentHistoryAvailable = true;
    evidence.deploymentHistoryEvidence = `提交数=${items.length}，样例: ${commitSnapshot}`;
    evidence.evidenceChain.push(`发布历史证据: ${evidence.deploymentHistoryEvidence}`);
  }

  private async collectMetricsEvidence(evidence: ReleaseEvidence): Promise<void> {
    try {
      const tool = this.agentService;
      // Use the agent service's internal method is not accessible,
      // so we call the tool directly through the agent service's execute path.
      // For fallback, we use a simpler approach.
      const result = await this.callMetricsTool();
      if (!result.success) {
        const message = result.message || 'Prometheus 返回失败状态';
        evidence.activeAlerts = false;
        evidence.activeAlertCount = 0;
        evidence.activeAlertEvidence = message;
        evidence.evidenceChain.push(`服务基线证据不足: ${message}`);
        return;
      }

      const alertCount = result.alerts?.length ?? 0;
      evidence.activeAlerts = alertCount > 0;
      evidence.activeAlertCount = alertCount;

      if (alertCount === 0) {
        evidence.activeAlertEvidence = '当前未检测到活跃告警。';
        evidence.evidenceChain.push('服务基线证据: 当前无活跃告警。');
        return;
      }

      const alertNames = (result.alerts ?? [])
        .slice(0, 3)
        .map((a: { alert_name: string }) => a.alert_name || 'unknown-alert');

      evidence.activeAlertEvidence = `检测到 ${alertCount} 条活跃告警，样例: ${alertNames.join(', ')}`;
      evidence.evidenceChain.push(`服务基线证据: ${evidence.activeAlertEvidence}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message }, '采集 Prometheus 告警证据失败');
      evidence.activeAlerts = false;
      evidence.activeAlertCount = 0;
      evidence.activeAlertEvidence = `Prometheus 查询失败，无法确认当前活跃告警状态: ${message}`;
      evidence.evidenceChain.push(`服务基线证据不足: ${evidence.activeAlertEvidence}`);
    }
  }

  private async collectRunbookEvidence(
    request: ReleasePrecheckRequest,
    evidence: ReleaseEvidence,
  ): Promise<void> {
    const query = `${request.serviceName} 回滚 runbook SOP 发布失败处理`;
    const probe = await this.queryDocsFallback(query, '回滚', 'rollback', 'sop');
    evidence.rollbackRunbookFound = probe.keywordHit;
    evidence.rollbackRunbookEvidence = probe.evidence;
    if (probe.keywordHit) {
      evidence.evidenceChain.push(`回滚手册证据: ${probe.evidence}`);
    } else {
      evidence.evidenceChain.push(`回滚手册证据不足: ${probe.evidence}`);
    }
  }

  private async collectIncidentEvidence(
    request: ReleasePrecheckRequest,
    evidence: ReleaseEvidence,
  ): Promise<void> {
    const query = `${request.serviceName} 发布 失败 复盘 事故`;
    const probe = await this.queryDocsFallback(query, '故障', '失败', '事故', '回滚');
    evidence.recentIncidentFound = probe.keywordHit;
    evidence.recentIncidentEvidence = probe.evidence;
    if (probe.keywordHit) {
      evidence.evidenceChain.push(`历史故障证据: ${probe.evidence}`);
    } else {
      evidence.evidenceChain.push(`历史故障证据不足: ${probe.evidence}`);
    }
  }

  private appendRequiredEvidenceStatus(evidence: ReleaseEvidence): void {
    const required = this.config.release.precheck.requiredEvidence;
    if (required.deploymentHistory && !evidence.deploymentHistoryAvailable) {
      evidence.evidenceChain.push('必要证据缺失: deployment-history');
    }
    if (required.serviceBaseline && !evidence.activeAlertEvidence) {
      evidence.evidenceChain.push('必要证据缺失: service-baseline');
    }
    if (required.rollbackRunbook && !evidence.rollbackRunbookFound) {
      evidence.evidenceChain.push('必要证据缺失: rollback-runbook');
    }
  }

  // -------------------------------------------------------------------------
  // Private: Tool calling for fallback path
  // -------------------------------------------------------------------------

  private async callMetricsTool(): Promise<{ success: boolean; alerts: Array<{ alert_name: string }>; message: string }> {
    // Access the tool through the agent service's internal structure
    // This is a simplified fallback - the main path uses the agent service
    const tool = (this.agentService as unknown as { queryMetricsTool: Tool }).queryMetricsTool;
    if (!tool?.execute) {
      return { success: false, alerts: [], message: 'Metrics tool not available' };
    }
    const raw = await tool.execute({} as Record<string, unknown>, { toolCallId: 'fallback', messages: [] });
    if (typeof raw === 'string') {
      return JSON.parse(raw);
    }
    return raw as { success: boolean; alerts: Array<{ alert_name: string }>; message: string };
  }

  private async queryDocsFallback(
    query: string,
    ...keywords: string[]
  ): Promise<{ keywordHit: boolean; evidence: string }> {
    try {
      const tool = (this.agentService as unknown as { internalDocsTool: Tool }).internalDocsTool;
      if (!tool?.execute) {
        return { keywordHit: false, evidence: '文档检索工具不可用' };
      }
      const raw = await tool.execute({ query } as Record<string, unknown>, { toolCallId: 'fallback', messages: [] });

      if (!raw) {
        return { keywordHit: false, evidence: '文档检索返回空内容。' };
      }

      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Handle no-results response
      if (!Array.isArray(parsed) && parsed.status?.toLowerCase() === 'no_results') {
        return {
          keywordHit: false,
          evidence: parsed.message || '未检索到相关文档。',
        };
      }

      // Handle array results
      if (Array.isArray(parsed) && parsed.length > 0) {
        const snippets = parsed
          .slice(0, 2)
          .map((item: Record<string, string>) =>
            this.firstNonBlank(item.content, item.text, item.document, item.title),
          );

        const merged = snippets.join(' | ');
        const truncated = this.truncate(merged, 220);
        return {
          keywordHit: this.containsKeywords(truncated, keywords),
          evidence: truncated,
        };
      }

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
  // Private: Watch metrics and rollback plan
  // -------------------------------------------------------------------------

  private buildWatchMetrics(scoreResult: RiskScoreResult, evidence: ReleaseEvidence): WatchMetric[] {
    const metrics: WatchMetric[] = [];

    metrics.push({
      name: 'error_rate',
      threshold: scoreResult.riskLevel === 'HIGH' ? '> 0.5%' : '> 1.0%',
      reason: '直接反映发布后稳定性变化',
      source: 'queryPrometheusAlerts',
    });

    metrics.push({
      name: 'p95_latency',
      threshold: scoreResult.riskLevel === 'HIGH' ? '> 800ms' : '> 1200ms',
      reason: '识别性能回退',
      source: 'service-baseline',
    });

    metrics.push({
      name: 'cpu_usage',
      threshold: '> 80%',
      reason: '识别资源压力与扩容需求',
      source: 'service-baseline',
    });

    metrics.push({
      name: 'pod_restart_count',
      threshold: '> 0',
      reason: '快速发现崩溃/重启异常',
      source: 'system-events',
    });

    if (evidence.activeAlerts) {
      metrics.push({
        name: 'active_alert_count',
        threshold: '= 0',
        reason: '发布前已有告警，发布后必须清零',
        source: 'queryPrometheusAlerts',
      });
    }

    return metrics;
  }

  private buildRollbackPlan(evidence: ReleaseEvidence): RollbackStep[] {
    const steps: RollbackStep[] = [];

    steps.push({
      stepOrder: 1,
      action: '立即冻结发布流水线并通知值班 SRE/TL',
      owner: '发布经理',
      expectedTime: '2 分钟',
      fallback: '若通知失败，直接在群内 @oncall 值班人并电话升级',
    });

    if (evidence.rollbackRunbookFound) {
      steps.push({
        stepOrder: 2,
        action: '按已检索回滚手册执行版本回退（先流量摘除后回滚）',
        owner: '值班 SRE',
        expectedTime: '5-10 分钟',
        fallback: '若手册步骤与现场不匹配，执行标准化蓝绿切回策略',
      });
    } else {
      steps.push({
        stepOrder: 2,
        action: '执行标准化回滚：切流 -> 回退上一稳定版本 -> 验证核心指标',
        owner: '值班 SRE',
        expectedTime: '8-12 分钟',
        fallback: '若无法切回，执行服务降级并触发人工应急预案',
      });
    }

    steps.push({
      stepOrder: 3,
      action: '回滚后复核 error_rate / p95_latency / active_alert_count 并形成复盘记录',
      owner: '服务负责人',
      expectedTime: '10 分钟',
      fallback: '若指标未恢复，启动故障应急流程并升级到平台团队',
    });

    return steps;
  }

  // -------------------------------------------------------------------------
  // Private: Utility helpers
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
