/**
 * 发布预检报告组装服务
 *
 * Ported from Java ReleaseReportService.java.
 *
 * Generates human-readable summaries and Markdown reports from
 * precheck results and evidence.
 */

import type {
  PrecheckResult,
  RiskFactor,
  WatchMetric,
  RollbackStep,
} from '../types/release.js';
import type { ReleaseEvidence } from '../types/evidence.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a one-line summary from precheck result and evidence.
 *
 * Extracts the top 2 risk factors by score impact and combines with
 * alert status into a concise Chinese summary.
 */
export function buildSummary(
  result: PrecheckResult,
  evidence: ReleaseEvidence,
): string {
  const topFactors = [...result.riskFactors]
    .sort((a, b) => b.scoreImpact - a.scoreImpact)
    .slice(0, 2)
    .map((f) => f.factor)
    .join('、');

  const topFactorsText = topFactors || '未命中高风险规则';

  const alertStatus = evidence.activeAlerts
    ? `存在 ${evidence.activeAlertCount} 条活跃告警`
    : '未检测到活跃告警';

  return (
    `服务 ${result.serviceName} 的发布预检完成，风险分 ${result.riskScore}（${result.riskLevel}），` +
    `决策 ${result.decision}。关键风险：${topFactorsText}；当前健康状态：${alertStatus}。`
  );
}

/**
 * Build a full Markdown report from precheck result and evidence.
 *
 * Sections: change summary, risk scoring, evidence chain, risk factors,
 * release strategy, watch metrics, rollback plan, and approval summary.
 */
export function buildMarkdown(
  result: PrecheckResult,
  evidence: ReleaseEvidence,
): string {
  const lines: string[] = [];

  // Header
  lines.push('# 发布变更预检报告');
  lines.push('');

  // Change summary
  lines.push('## 变更摘要');
  lines.push(`- 服务: ${result.serviceName}`);
  lines.push(`- 环境: ${result.environment}`);
  lines.push(`- 发布窗口: ${result.releaseWindow}`);
  lines.push(`- 变更说明: ${result.changeSummary}`);
  lines.push('');

  // Risk scoring
  lines.push('## 风险评分与等级');
  lines.push(`- riskScore: ${result.riskScore}`);
  lines.push(`- riskLevel: ${result.riskLevel}`);
  lines.push(`- decision: ${result.decision}`);
  lines.push('');

  // Evidence chain
  lines.push('## 证据链');
  appendList(lines, result.evidenceChain);
  lines.push('');

  // Risk factors
  lines.push('## 风险因子');
  for (const factor of result.riskFactors) {
    lines.push(
      `- ${factor.factor} | level=${factor.level} | impact=${factor.scoreImpact} | evidenceStatus=${factor.evidenceStatus}`,
    );
    lines.push(`  证据: ${factor.evidence}`);
    lines.push(`  来源: ${factor.evidenceSource}`);
  }
  lines.push('');

  // Release strategy
  lines.push('## 发布策略建议');
  lines.push(result.releaseStrategy);
  lines.push('');

  // Watch metrics
  lines.push('## 观测指标与阈值建议');
  for (const metric of result.watchMetrics) {
    lines.push(
      `- ${metric.name} | 阈值: ${metric.threshold} | 说明: ${metric.reason} | 来源: ${metric.source}`,
    );
  }
  lines.push('');

  // Rollback plan
  lines.push('## 回滚预案');
  for (const step of result.rollbackPlan) {
    lines.push(
      `${step.stepOrder}. ${step.action}（Owner: ${step.owner}，预计耗时: ${step.expectedTime}）`,
    );
    lines.push(`   失败回退: ${step.fallback}`);
  }
  lines.push('');

  // Approval summary
  lines.push('## 审批摘要');
  lines.push(result.summary);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function appendList(lines: string[], items: string[] | null | undefined): void {
  if (items == null || items.length === 0) {
    lines.push('- 暂无证据条目');
    return;
  }
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}
