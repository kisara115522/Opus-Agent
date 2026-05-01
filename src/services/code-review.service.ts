/**
 * Code Review Service - ported from Java CodeReviewService.java
 *
 * Main orchestrator for the code review pipeline:
 *   validate -> collect git -> evaluate risks -> RAG evidence -> agent review -> assemble report
 */

import { randomUUID } from 'node:crypto';
import { access, constants } from 'node:fs/promises';
import pino from 'pino';
import type { LanguageModel } from 'ai';
import type { AppConfig } from '../config/index.js';
import type {
  CodeReviewRequest,
  CodeReviewResult,
  CodeReviewFinding,
  CodeReviewCommit,
  CodeReviewIncidentEvidence,
} from '../types/review.js';
import type { GitCommit, GitFile, GitDiff } from '../utils/git.js';
import { collectCommits, collectChangedFiles, collectPatches, runGit } from '../utils/git.js';
import { isBlank, containsAny } from '../utils/text.js';
import { CodeReviewReportService } from './code-review-report.service.js';
import {
  CodeReviewAgentService,
  type AgentContext,
  type ProgressCallback,
} from './code-review-agent.service.js';

const logger = pino({ name: 'code-review-service' });

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReviewHistoryService {
  save(result: CodeReviewResult): Promise<CodeReviewResult>;
  getById(id: string): Promise<CodeReviewResult | undefined>;
  latest(limit: number): Promise<CodeReviewResult[]>;
}

export interface CodeReviewDeps {
  config: AppConfig;
  llmProvider: LanguageModel;
  historyService: ReviewHistoryService;
  internalDocsTool?: { execute: (args: Record<string, unknown>, options: unknown) => Promise<unknown> };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CodeReviewService {
  private readonly config: AppConfig;
  private readonly agentService: CodeReviewAgentService;
  private readonly reportService: CodeReviewReportService;
  private readonly historyService: ReviewHistoryService;
  private readonly internalDocsTool?: CodeReviewDeps['internalDocsTool'];

  constructor(deps: CodeReviewDeps) {
    this.config = deps.config;
    this.agentService = new CodeReviewAgentService(deps.llmProvider, {
      agentMaxFiles: deps.config.code.review.agentMaxFiles,
      agentMaxPatchCharsPerFile: deps.config.code.review.agentMaxPatchCharsPerFile,
    });
    this.reportService = new CodeReviewReportService();
    this.historyService = deps.historyService;
    this.internalDocsTool = deps.internalDocsTool;
  }

  /**
   * Main entry point: run a code review.
   */
  async review(
    request: CodeReviewRequest,
    progress?: (msg: string) => void,
  ): Promise<CodeReviewResult> {
    const reviewConfig = this.config.code.review;

    // Step 1: Validate
    this.emit(progress, '步骤 1/6: 校验请求...');
    this.validate(request);

    // Step 2: Collect Git info
    this.emit(progress, '步骤 2/6: 收集 Git 变更信息...');
    const commandTimeout = reviewConfig.commandTimeoutSeconds * 1000;
    const { commits, changedFiles, patches, commitRange } = await this.collectGitInfo(
      request,
      commandTimeout,
    );

    // Step 3: Evaluate rule-based risks
    this.emit(progress, '步骤 3/6: 规则引擎评估风险...');
    const ruleFindings = this.evaluateRisks(request, commits, changedFiles, patches);

    // Step 4: RAG evidence
    this.emit(progress, '步骤 4/6: RAG 历史事故证据检索...');
    const { ragEvidence, incidentEvidences } = await this.collectRagEvidence(ruleFindings);

    // Step 5: Agent review
    this.emit(progress, '步骤 5/6: 多 Agent 协作审查...');
    let agentResult: Awaited<ReturnType<CodeReviewAgentService['runMultiAgentReview']>> | null = null;
    if (reviewConfig.agentEnabled) {
      const agentContext: AgentContext = {
        projectPath: request.projectPath,
        baseRef: request.baseRef,
        headRef: request.headRef,
        commitRange,
        commits: commits.map((c) => ({ commitId: c.commitId, author: c.author, message: c.message })),
        changedFiles: changedFiles.map((f) => f.path),
        patches: patches.map((p) => ({ path: p.path, patch: p.patch })),
        ruleFindings,
        ragEvidence,
      };

      try {
        agentResult = await this.agentService.runMultiAgentReview(
          agentContext,
          ruleFindings,
          ragEvidence,
          progress,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ error: message }, '多 Agent 审查执行失败，继续使用规则引擎结果');
      }
    }

    // Step 6: Assemble result
    this.emit(progress, '步骤 6/6: 组装审查报告...');
    const result = this.assembleResult(
      request,
      commits,
      changedFiles,
      patches,
      commitRange,
      ruleFindings,
      ragEvidence,
      incidentEvidences,
      agentResult,
    );

    // Save to history
    await this.historyService.save(result);
    this.emit(progress, `审查完成，ID: ${result.id}`);

    return result;
  }

  /**
   * Get a review result by ID.
   */
  async getById(id: string): Promise<CodeReviewResult | undefined> {
    return this.historyService.getById(id);
  }

  /**
   * List recent review results.
   */
  async latest(limit: number): Promise<CodeReviewResult[]> {
    return this.historyService.latest(limit);
  }

  // -------------------------------------------------------------------------
  // Step 1: Validate
  // -------------------------------------------------------------------------

  private validate(request: CodeReviewRequest): void {
    if (!request) {
      throw new Error('请求体不能为空');
    }
    if (!request.permissionGranted) {
      throw new Error('用户未授权读取本地 Git 信息，请设置 permissionGranted=true');
    }
    if (isBlank(request.projectPath)) {
      throw new Error('projectPath 不能为空');
    }

    // Enforce allowed roots if configured
    const reviewConfig = this.config.code.review;
    if (reviewConfig.requireAllowedRoots && reviewConfig.allowedRoots.length > 0) {
      const resolved = request.projectPath;
      const isAllowed = reviewConfig.allowedRoots.some((root) => {
        return resolved === root || resolved.startsWith(root + '/') || resolved.startsWith(root + '\\');
      });
      if (!isAllowed) {
        throw new Error(
          `项目路径不在允许范围内。允许的根目录: ${reviewConfig.allowedRoots.join(', ')}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Collect Git Info
  // -------------------------------------------------------------------------

  private async collectGitInfo(
    request: CodeReviewRequest,
    commandTimeout: number,
  ): Promise<{
    commits: GitCommit[];
    changedFiles: GitFile[];
    patches: GitDiff[];
    commitRange: string;
  }> {
    const { projectPath, baseRef, headRef } = request;

    // Verify the directory exists and is a git repo
    await this.assertGitRepo(projectPath);

    const reviewConfig = this.config.code.review;

    // Collect commits (limit by maxCommits)
    let commits: GitCommit[];
    try {
      commits = await collectCommits(projectPath, baseRef, headRef || 'HEAD');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message, baseRef, headRef }, '收集提交记录失败');
      commits = [];
    }

    if (commits.length > reviewConfig.maxCommits) {
      commits = commits.slice(0, reviewConfig.maxCommits);
    }

    // Collect changed files (limit by maxFiles)
    let changedFiles: GitFile[];
    try {
      changedFiles = await collectChangedFiles(projectPath, baseRef, headRef || 'HEAD');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message, baseRef, headRef }, '收集变更文件失败');
      changedFiles = [];
    }

    if (changedFiles.length > reviewConfig.maxFiles) {
      changedFiles = changedFiles.slice(0, reviewConfig.maxFiles);
    }

    // Collect patches (limit by maxPatchCharsPerFile)
    let patches: GitDiff[];
    try {
      patches = await collectPatches(
        projectPath,
        baseRef,
        headRef || 'HEAD',
        reviewConfig.maxPatchCharsPerFile,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message, baseRef, headRef }, '收集 Patch 失败');
      patches = [];
    }

    const commitRange = `${baseRef}..${headRef || 'HEAD'}`;

    return { commits, changedFiles, patches, commitRange };
  }

  private async assertGitRepo(projectPath: string): Promise<void> {
    try {
      await access(projectPath, constants.R_OK);
    } catch {
      throw new Error(`项目路径不存在或不可读: ${projectPath}`);
    }

    try {
      await runGit(['rev-parse', '--git-dir'], { cwd: projectPath, timeout: 5000 });
    } catch {
      throw new Error(`项目路径不是一个有效的 Git 仓库: ${projectPath}`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Evaluate Risks (Rule Engine)
  // -------------------------------------------------------------------------

  private evaluateRisks(
    request: CodeReviewRequest,
    commits: GitCommit[],
    changedFiles: GitFile[],
    patches: GitDiff[],
  ): CodeReviewFinding[] {
    const findings: CodeReviewFinding[] = [];

    // missing-commit-context
    if (commits.length === 0) {
      findings.push(this.buildFinding(
        'missing-commit-context',
        '缺少提交上下文',
        'MEDIUM',
        10,
        '',
        '未找到提交记录，可能因 ref 无效或仓库为空。',
        '确认 baseRef 和 headRef 是否正确。',
      ));
    }

    // huge-change-set / large-change-set
    const fileCount = changedFiles.length;
    if (fileCount > 80) {
      findings.push(this.buildFinding(
        'huge-change-set',
        '超大规模变更集',
        'HIGH',
        20,
        '',
        `变更文件数 ${fileCount} 超过 80，审查覆盖面不足风险较高。`,
        '拆分为更小的 PR 以便充分审查。',
      ));
    } else if (fileCount > 35) {
      findings.push(this.buildFinding(
        'large-change-set',
        '大规模变更集',
        'MEDIUM',
        10,
        '',
        `变更文件数 ${fileCount} 超过 35，建议分批提交。`,
        '考虑拆分 PR 或增加审查人员。',
      ));
    }

    // missing-tests
    const hasSourceChanges = changedFiles.some((f) =>
      this.isSourceFile(f.path) && !this.isTestFile(f.path),
    );
    const hasTestChanges = changedFiles.some((f) => this.isTestFile(f.path));
    if (hasSourceChanges && !hasTestChanges) {
      findings.push(this.buildFinding(
        'missing-tests',
        '缺少测试变更',
        'MEDIUM',
        12,
        '',
        '源代码文件发生变更但未包含测试文件的修改。',
        '请补充或更新对应的单元测试/集成测试。',
      ));
    }

    // config-change
    const configFiles = changedFiles.filter((f) => this.isConfigFile(f.path));
    if (configFiles.length > 0) {
      const samplePaths = configFiles.slice(0, 3).map((f) => f.path).join(', ');
      findings.push(this.buildFinding(
        'config-change',
        '配置文件变更',
        'MEDIUM',
        8,
        samplePaths,
        `检测到配置文件变更: ${samplePaths}`,
        '确认配置变更是否已在目标环境验证。',
      ));
    }

    // db-change
    const dbFiles = changedFiles.filter((f) => this.isDbChangeFile(f.path));
    if (dbFiles.length > 0) {
      const samplePaths = dbFiles.slice(0, 3).map((f) => f.path).join(', ');
      findings.push(this.buildFinding(
        'db-change',
        '数据库变更',
        'HIGH',
        18,
        samplePaths,
        `检测到数据库相关文件变更: ${samplePaths}`,
        '确认 DDL/DML 变更已通过 DBA 审核，并有回滚脚本。',
      ));
    }

    // high-churn / medium-churn
    const totalPatchLines = patches.reduce((sum, p) => sum + p.patch.split('\n').length, 0);
    if (totalPatchLines > 1500) {
      findings.push(this.buildFinding(
        'high-churn',
        '高代码变动量',
        'HIGH',
        15,
        '',
        `总变更行数 ${totalPatchLines} 超过 1500 行。`,
        '变更量较大，建议拆分 PR 或增加审查关注点。',
      ));
    } else if (totalPatchLines > 600) {
      findings.push(this.buildFinding(
        'medium-churn',
        '中等代码变动量',
        'MEDIUM',
        8,
        '',
        `总变更行数 ${totalPatchLines} 超过 600 行。`,
        '变更量适中，建议重点关注核心模块变更。',
      ));
    }

    // sensitive-value
    const sensitivePatterns = [
      /password\s*[=:]\s*["'][^"']+["']/gi,
      /secret\s*[=:]\s*["'][^"']+["']/gi,
      /api[_-]?key\s*[=:]\s*["'][^"']+["']/gi,
      /token\s*[=:]\s*["'][^"']+["']/gi,
    ];
    for (const patch of patches) {
      for (const pattern of sensitivePatterns) {
        if (pattern.test(patch.patch)) {
          findings.push(this.buildFinding(
            'sensitive-value',
            '敏感信息泄露风险',
            'CRITICAL',
            25,
            patch.path,
            `在 ${patch.path} 中检测到疑似敏感信息（password/secret/api_key/token）。`,
            '请将敏感信息移至环境变量或密钥管理系统。',
          ));
          break; // One finding per file is enough
        }
      }
    }

    // broad-catch
    for (const patch of patches) {
      if (containsAny(patch.patch, 'catch(Exception', 'catch (Exception', 'catch(e)', 'catch (e)')) {
        findings.push(this.buildFinding(
          'broad-catch',
          '过于宽泛的异常捕获',
          'LOW',
          3,
          patch.path,
          `在 ${patch.path} 中检测到宽泛的异常捕获模式。`,
          '使用具体异常类型代替宽泛捕获，避免隐藏错误。',
        ));
      }
    }

    // todo-left
    for (const patch of patches) {
      const addedLines = patch.patch
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'));
      const todoLines = addedLines.filter((line) =>
        containsAny(line, 'TODO', 'FIXME', 'HACK', 'XXX'),
      );
      if (todoLines.length > 0) {
        findings.push(this.buildFinding(
          'todo-left',
          '残留 TODO/FIXME 标记',
          'LOW',
          2,
          patch.path,
          `在 ${patch.path} 的新增代码中发现 ${todoLines.length} 处 TODO/FIXME 标记。`,
          '合入前请处理或记录为已知待办项。',
        ));
      }
    }

    // no-risk-signal (default if nothing found)
    if (findings.length === 0) {
      findings.push(this.buildFinding(
        'no-risk-signal',
        '未发现显著风险信号',
        'LOW',
        0,
        '',
        '规则引擎未检测到显著风险信号。',
        '建议结合 Agent 深度审查结果做最终判断。',
      ));
    }

    return findings;
  }

  // -------------------------------------------------------------------------
  // Step 4: RAG Evidence
  // -------------------------------------------------------------------------

  private async collectRagEvidence(
    ruleFindings: CodeReviewFinding[],
  ): Promise<{
    ragEvidence: string;
    incidentEvidences: CodeReviewIncidentEvidence[];
  }> {
    const reviewConfig = this.config.code.review;

    if (!reviewConfig.ragEvidenceEnabled || !this.internalDocsTool) {
      return { ragEvidence: '', incidentEvidences: [] };
    }

    // Build queries from high-severity findings
    const highFindings = ruleFindings.filter(
      (f) => f.severity === 'CRITICAL' || f.severity === 'HIGH',
    );

    if (highFindings.length === 0) {
      return { ragEvidence: '', incidentEvidences: [] };
    }

    const queries = highFindings
      .slice(0, reviewConfig.ragQueriesPerReview)
      .map((f) => `${f.ruleKey} ${f.title} 事故 复盘 故障`);

    const evidences: CodeReviewIncidentEvidence[] = [];
    const snippets: string[] = [];

    for (const query of queries) {
      try {
        const raw = await this.internalDocsTool.execute(
          { query } as Record<string, unknown>,
          { toolCallId: 'rag-evidence', messages: [] },
        );

        if (!raw) {
          evidences.push({ query, status: 'empty', snippet: '', source: '' });
          continue;
        }

        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

        if (Array.isArray(parsed) && parsed.length > 0) {
          const item = parsed[0];
          const snippet = item.content || item.text || item.document || item.title || '';
          const source = item.source || item.title || '';
          evidences.push({ query, status: 'found', snippet, source });
          if (snippet) {
            snippets.push(snippet);
          }
        } else {
          const message = (parsed as { message?: string }).message || '未检索到相关文档。';
          evidences.push({ query, status: 'no_results', snippet: message, source: '' });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ query, error: message }, 'RAG 证据检索失败');
        evidences.push({ query, status: 'error', snippet: message, source: '' });
      }
    }

    return {
      ragEvidence: snippets.join('\n---\n'),
      incidentEvidences: evidences,
    };
  }

  // -------------------------------------------------------------------------
  // Step 6: Assemble Result
  // -------------------------------------------------------------------------

  private assembleResult(
    request: CodeReviewRequest,
    commits: GitCommit[],
    changedFiles: GitFile[],
    patches: GitDiff[],
    commitRange: string,
    ruleFindings: CodeReviewFinding[],
    ragEvidence: string,
    incidentEvidences: CodeReviewIncidentEvidence[],
    agentResult: Awaited<ReturnType<CodeReviewAgentService['runMultiAgentReview']>> | null,
  ): CodeReviewResult {
    const reviewConfig = this.config.code.review;
    const now = new Date().toISOString();
    const id = randomUUID();

    // Merge agent findings with rule findings
    const allFindings = [...ruleFindings];
    if (agentResult?.success && agentResult.findings.length > 0) {
      allFindings.push(...agentResult.findings);
    }

    // Compute score: sum of all finding scoreImpact + agent scoreAdjustment
    let score = allFindings.reduce((sum, f) => sum + f.scoreImpact, 0);
    if (agentResult?.success) {
      score += agentResult.scoreAdjustment;
    }

    // If CRITICAL finding exists and score < 80, force score to 80
    const hasCritical = allFindings.some((f) => f.severity === 'CRITICAL');
    if (hasCritical && score < 80) {
      score = 80;
    }

    // Clamp score to 0-100
    score = Math.max(0, Math.min(100, score));

    // Determine risk level
    let riskLevel: string;
    if (score >= 70) {
      riskLevel = 'HIGH';
    } else if (score >= 40) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }

    // Determine decision
    const hasHigh = allFindings.some((f) => f.severity === 'HIGH');
    let decision: string;

    // Agent decision can escalate
    if (agentResult?.success) {
      if (agentResult.decisionSuggestion === 'BLOCK') {
        // Agent suggests BLOCK: escalate score adjustment
        if (agentResult.scoreAdjustment < 18) {
          agentResult.scoreAdjustment = 18;
          score = allFindings.reduce((sum, f) => sum + f.scoreImpact, 0) + 18;
          if (hasCritical && score < 80) score = 80;
          score = Math.max(0, Math.min(100, score));
        }
      } else if (agentResult.decisionSuggestion === 'REVIEW_NEEDED') {
        // Agent suggests REVIEW_NEEDED: add +8 to adjustment
        score += 8;
        if (hasCritical && score < 80) score = 80;
        score = Math.max(0, Math.min(100, score));
      }
    }

    if (hasCritical || score >= reviewConfig.blockScore || hasHigh) {
      decision = 'BLOCK';
    } else if (commits.length === 0) {
      decision = 'REVIEW_NEEDED';
    } else {
      decision = 'PASS';
    }

    // Build evidence chain
    const evidenceChain: string[] = [];
    evidenceChain.push(`规则引擎发现 ${ruleFindings.length} 项`);
    if (agentResult?.success) {
      evidenceChain.push(`Agent 审查发现 ${agentResult.findings.length} 项`);
      evidenceChain.push(`Agent 决策建议: ${agentResult.decisionSuggestion}`);
    }
    if (ragEvidence) {
      evidenceChain.push(`RAG 检索到 ${incidentEvidences.filter((e) => e.status === 'found').length} 条相关事故证据`);
    }

    // Build agent mode string
    const agentMode = agentResult?.success ? 'planner-reviewer-judge' : 'rule-engine-only';

    // Map commits to DTO
    const commitDtos: CodeReviewCommit[] = commits.map((c) => ({
      commitId: c.commitId,
      author: c.author,
      committedAt: c.committedAt,
      message: c.message,
    }));

    // Build result
    const result: CodeReviewResult = {
      id,
      projectPath: request.projectPath,
      baseRef: request.baseRef,
      headRef: request.headRef,
      commitRange,
      totalCommits: commits.length,
      totalChangedFiles: changedFiles.length,
      riskScore: score,
      riskLevel,
      decision,
      summary: '',
      reportMarkdown: '',
      status: 'completed',
      reviewedAt: now,
      operator: request.operator || 'unknown',
      notes: request.notes || '',
      agentMode,
      plannerOutput: agentResult?.plannerOutput || '',
      reviewerOutput: agentResult?.reviewerOutput || '',
      judgeOutput: agentResult?.judgeOutput || '',
      agentSummary: agentResult?.summary || '',
      commits: commitDtos,
      findings: allFindings,
      incidentEvidences,
      changedFiles: changedFiles.map((f) => f.path),
      evidenceChain,
    };

    // Build summary and markdown report
    result.summary = this.reportService.buildSummary(result);
    result.reportMarkdown = this.reportService.buildMarkdown(result);

    return result;
  }

  // -------------------------------------------------------------------------
  // File classification helpers
  // -------------------------------------------------------------------------

  private isSourceFile(path: string): boolean {
    const ext = this.getExtension(path);
    return ['ts', 'tsx', 'js', 'jsx', 'java', 'py', 'go', 'rs', 'cpp', 'c', 'cs', 'rb', 'php', 'kt', 'scala'].includes(ext);
  }

  private isTestFile(path: string): boolean {
    const lower = path.toLowerCase();
    return (
      lower.includes('.test.') ||
      lower.includes('.spec.') ||
      lower.includes('_test.') ||
      lower.includes('__tests__/') ||
      lower.includes('/test/') ||
      lower.includes('/tests/') ||
      lower.includes('test_') ||
      lower.includes('spec_')
    );
  }

  private isConfigFile(path: string): boolean {
    const ext = this.getExtension(path);
    const lower = path.toLowerCase();
    return (
      ['yml', 'yaml', 'properties', 'env', 'conf', 'toml', 'ini'].includes(ext) ||
      lower.includes('docker-compose') ||
      lower.includes('/config/') ||
      lower.endsWith('.env') ||
      lower.endsWith('.env.local') ||
      lower.endsWith('.env.production')
    );
  }

  private isDbChangeFile(path: string): boolean {
    const lower = path.toLowerCase();
    return (
      lower.includes('migration') ||
      lower.includes('migrate') ||
      lower.endsWith('.sql') ||
      lower.endsWith('.ddl') ||
      lower.includes('schema') ||
      lower.includes('flyway') ||
      lower.includes('liquibase')
    );
  }

  private getExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1) return '';
    return path.slice(lastDot + 1).toLowerCase();
  }

  // -------------------------------------------------------------------------
  // Finding builder helper
  // -------------------------------------------------------------------------

  private buildFinding(
    ruleKey: string,
    title: string,
    severity: string,
    scoreImpact: number,
    filePath: string,
    evidence: string,
    recommendation: string,
  ): CodeReviewFinding {
    return {
      ruleKey,
      title,
      severity,
      scoreImpact,
      filePath,
      evidence,
      recommendation,
      source: 'rule-engine',
    };
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  private emit(progress: ((msg: string) => void) | undefined, message: string): void {
    if (progress) {
      progress(message);
    }
  }
}
