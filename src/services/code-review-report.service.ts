/**
 * Code Review Report Service - ported from Java CodeReviewReportService.java
 *
 * Assembles the code review report in summary and markdown formats.
 */

import type { CodeReviewResult } from '../types/review.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map severity to a numeric rank for sorting (lower = more severe).
 */
export function severityRank(severity: string): number {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL':
      return 0;
    case 'HIGH':
      return 1;
    case 'MEDIUM':
      return 2;
    default:
      return 3;
  }
}

/**
 * Convert null/undefined/empty values to a dash placeholder.
 */
export function nullToDash(value: string | null | undefined): string {
  if (value === null || value === undefined || value.trim() === '') {
    return '-';
  }
  return value;
}

/**
 * Truncate a string to the given limit, appending '...' if truncated.
 */
export function truncateStr(value: string | null | undefined, limit: number): string {
  if (!value) return '';
  if (value.length <= limit) return value;
  return value.substring(0, Math.max(0, limit - 3)) + '...';
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CodeReviewReportService {
  /**
   * Build a one-line summary of the code review result.
   */
  buildSummary(result: CodeReviewResult): string {
    const commitText = result.totalCommits > 0
      ? `${result.totalCommits} 个提交`
      : '无提交记录';

    const fileText = `${result.totalChangedFiles} 个文件变更`;

    const topFindings = [...result.findings]
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.scoreImpact - a.scoreImpact)
      .slice(0, 2)
      .map((f) => f.title)
      .join('、');

    const findingText = topFindings || '未发现显著风险';

    return (
      `代码审查完成，风险分 ${result.riskScore}（${result.riskLevel}），` +
      `决策 ${result.decision}。范围：${commitText}，${fileText}。` +
      `关键发现：${findingText}。`
    );
  }

  /**
   * Build a full markdown report of the code review result.
   */
  buildMarkdown(result: CodeReviewResult): string {
    const lines: string[] = [];

    // -- Section 1: 审查结论 --
    lines.push('# 代码审查报告\n');
    lines.push('## 审查结论');
    lines.push(`- 决策: ${nullToDash(result.decision)}`);
    lines.push(`- 风险分: ${result.riskScore}`);
    lines.push(`- 风险等级: ${nullToDash(result.riskLevel)}`);
    lines.push(`- Agent 模式: ${nullToDash(result.agentMode)}`);
    lines.push(`- 摘要: ${nullToDash(result.summary)}`);
    if (result.agentSummary) {
      lines.push(`- Agent 摘要: ${result.agentSummary}`);
    }
    lines.push('');

    // -- Section 2: 审查范围 --
    lines.push('## 审查范围');
    lines.push(`- 项目路径: ${nullToDash(result.projectPath)}`);
    lines.push(`- 提交区间: ${nullToDash(result.commitRange)}`);
    lines.push(`- 提交数: ${result.totalCommits}`);
    lines.push(`- 变更文件数: ${result.totalChangedFiles}`);
    lines.push(`- 操作人: ${nullToDash(result.operator)}`);
    lines.push(`- 审查时间: ${nullToDash(result.reviewedAt)}`);
    if (result.changedFiles.length > 0) {
      lines.push('');
      lines.push('变更文件（样例）:');
      const sample = result.changedFiles.slice(0, 15);
      for (const file of sample) {
        lines.push(`- ${file}`);
      }
      if (result.changedFiles.length > sample.length) {
        lines.push(`- ... 共 ${result.changedFiles.length} 个文件`);
      }
    }
    lines.push('');

    // -- Section 3: 关键风险项 --
    lines.push('## 关键风险项');
    const sortedFindings = [...result.findings].sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        b.scoreImpact - a.scoreImpact,
    );

    if (sortedFindings.length === 0) {
      lines.push('暂无风险发现。');
    } else {
      for (const finding of sortedFindings) {
        lines.push(
          `- **[${finding.severity}]** ${nullToDash(finding.title)} (影响 +${finding.scoreImpact}分)`,
        );
        lines.push(`  - 规则: ${nullToDash(finding.ruleKey)}`);
        lines.push(`  - 文件: ${nullToDash(finding.filePath)}`);
        if (finding.evidence) {
          lines.push(`  - 证据: ${truncateStr(finding.evidence, 200)}`);
        }
        if (finding.recommendation) {
          lines.push(`  - 建议: ${finding.recommendation}`);
        }
      }
    }
    lines.push('');

    // -- Section 4: 建议执行项 --
    lines.push('## 建议执行项');
    const recommendations = [
      ...new Set(
        result.findings
          .map((f) => f.recommendation)
          .filter((r): r is string => !!r && r.trim() !== ''),
      ),
    ];

    if (recommendations.length === 0) {
      lines.push('暂无额外建议。');
    } else {
      for (const rec of recommendations) {
        lines.push(`- ${rec}`);
      }
    }
    lines.push('');

    // -- Section 5: 提交与历史证据 --
    lines.push('## 提交与历史证据');

    if (result.commits.length > 0) {
      lines.push('### 提交摘要');
      for (const commit of result.commits.slice(0, 10)) {
        lines.push(
          `- \`${commit.commitId}\` ${nullToDash(commit.author)}: ${truncateStr(commit.message, 80)}`,
        );
      }
      if (result.commits.length > 10) {
        lines.push(`- ... 共 ${result.commits.length} 个提交`);
      }
      lines.push('');
    }

    if (result.incidentEvidences.length > 0) {
      lines.push('### RAG 历史事故证据');
      for (const ev of result.incidentEvidences) {
        lines.push(`- 查询: ${nullToDash(ev.query)}`);
        lines.push(`  状态: ${nullToDash(ev.status)}`);
        lines.push(`  来源: ${nullToDash(ev.source)}`);
        if (ev.snippet) {
          lines.push(`  摘要: ${truncateStr(ev.snippet, 180)}`);
        }
      }
      lines.push('');
    }

    if (result.commits.length === 0 && result.incidentEvidences.length === 0) {
      lines.push('暂无提交记录与历史事故证据。');
      lines.push('');
    }

    // -- Section 6: 审查说明 --
    lines.push('## 审查说明');
    lines.push(
      '本报告由自动化代码审查系统生成，基于规则引擎、RAG 历史证据检索及多 Agent 协作审查。' +
      '报告结果仅供参考，最终决策应结合人工判断。',
    );

    return lines.join('\n');
  }
}
