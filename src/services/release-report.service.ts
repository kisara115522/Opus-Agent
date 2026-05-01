/**
 * Release Report Service - ported from Java ReleaseReportService.java
 *
 * Assembles the release precheck report in summary and markdown formats.
 */

import type { PrecheckResult } from '../types/release.js';
import type { ReleaseEvidence } from '../types/evidence.js';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ReleaseReportService {
  /**
   * Build a human-readable summary of the precheck result.
   */
  buildSummary(result: PrecheckResult, evidence: ReleaseEvidence): string {
    const topFactors = [...result.riskFactors]
      .sort((a, b) => b.scoreImpact - a.scoreImpact)
      .slice(0, 2)
      .map((f) => f.factor)
      .join('、');

    const factorText = topFactors || '未命中高风险规则';

    const alertStatus = evidence.activeAlerts
      ? `存在 ${evidence.activeAlertCount} 条活跃告警`
      : '未检测到活跃告警';

    return `服务 ${result.serviceName} 的发布预检完成，风险分 ${result.riskScore}（${result.riskLevel}），决策 ${result.decision}。关键风险：${factorText}；当前健康状态：${alertStatus}。`;
  }

  /**
   * Build a full markdown report of the precheck result.
   */
  buildMarkdown(result: PrecheckResult, evidence: ReleaseEvidence): string {
    const lines: string[] = [];

    lines.push('# 发布变更预检报告\n');
    lines.push('## 变更摘要');
    lines.push(`- 服务: ${result.serviceName}`);
    lines.push(`- 环境: ${result.environment}`);
    lines.push(`- 发布窗口: ${result.releaseWindow}`);
    lines.push(`- 变更说明: ${result.changeSummary}\n`);

    lines.push('## 风险评分与等级');
    lines.push(`- riskScore: ${result.riskScore}`);
    lines.push(`- riskLevel: ${result.riskLevel}`);
    lines.push(`- decision: ${result.decision}\n`);

    lines.push('## 证据链');
    lines.push(this.formatList(result.evidenceChain));
    lines.push('');

    lines.push('## 风险因子');
    for (const factor of result.riskFactors) {
      lines.push(
        `- ${factor.factor} | level=${factor.level} | impact=${factor.scoreImpact} | evidenceStatus=${factor.evidenceStatus}`,
      );
      lines.push(`  证据: ${factor.evidence}`);
      lines.push(`  来源: ${factor.evidenceSource}`);
    }
    lines.push('');

    lines.push('## 发布策略建议');
    lines.push(result.releaseStrategy);
    lines.push('');

    lines.push('## 观测指标与阈值建议');
    for (const metric of result.watchMetrics) {
      lines.push(
        `- ${metric.name} | 阈值: ${metric.threshold} | 说明: ${metric.reason} | 来源: ${metric.source}`,
      );
    }
    lines.push('');

    lines.push('## 回滚预案');
    for (const step of result.rollbackPlan) {
      lines.push(
        `${step.stepOrder}. ${step.action}（Owner: ${step.owner}，预计耗时: ${step.expectedTime}）`,
      );
      lines.push(`   失败回退: ${step.fallback}`);
    }
    lines.push('');

    lines.push('## 审批摘要');
    lines.push(result.summary);

    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private formatList(items: string[]): string {
    if (!items || items.length === 0) {
      return '- 暂无证据条目';
    }
    return items.map((item) => `- ${item}`).join('\n');
  }
}
