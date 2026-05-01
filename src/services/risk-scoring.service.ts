/**
 * Risk Scoring Service - ported from Java RiskScoringService.java
 *
 * Release precheck rule-based scoring engine (v1).
 * Evaluates 10 weighted risk factors based on request data and evidence.
 */

import pino from 'pino';
import type { AppConfig } from '../config/index.js';
import type { ReleasePrecheckRequest, RiskFactor } from '../types/release.js';
import type { ReleaseEvidence, RiskScoreResult } from '../types/evidence.js';

const logger = pino({ name: 'risk-scoring-service' });

// ---------------------------------------------------------------------------
// Weight key mapping (config camelCase -> scoring key)
// ---------------------------------------------------------------------------

const WEIGHT_KEY_MAP: Record<string, keyof AppConfig['release']['precheck']['scoreWeights']> = {
  production: 'production',
  'peak-window': 'peakWindow',
  emergency: 'emergency',
  'database-change': 'databaseChange',
  'config-change': 'configChange',
  'large-change': 'largeChange',
  'active-alerts': 'activeAlerts',
  'missing-runbook': 'missingRunbook',
  'recent-incident': 'recentIncident',
  'missing-deployment-history': 'missingDeploymentHistory',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class RiskScoringService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Score a release precheck request against collected evidence.
   */
  score(request: ReleasePrecheckRequest, evidence: ReleaseEvidence): RiskScoreResult {
    let score = 0;
    const factors: RiskFactor[] = [];

    // Production environment
    if (request.environment.toLowerCase() === 'prod' || request.environment.toLowerCase() === 'production') {
      score += this.addFactor(
        factors,
        '生产环境变更',
        'MEDIUM',
        this.weight('production', 15),
        '本次变更目标环境为生产环境',
        'request.environment',
        'SUFFICIENT',
      );
    }

    // Peak window
    if (this.isPeakWindow(request.releaseWindow)) {
      score += this.addFactor(
        factors,
        '高峰时段发布',
        'MEDIUM',
        this.weight('peak-window', 10),
        '发布窗口命中业务高峰时段（09:00-20:00）',
        'request.releaseWindow',
        'SUFFICIENT',
      );
    }

    // Emergency release
    if (request.emergencyRelease) {
      score += this.addFactor(
        factors,
        '紧急发布',
        'HIGH',
        this.weight('emergency', 20),
        '请求标记为紧急发布，发布准备时间较短',
        'request.emergencyRelease',
        'SUFFICIENT',
      );
    }

    // Database change
    if (this.containsDatabaseChange(request)) {
      score += this.addFactor(
        factors,
        '数据库相关变更',
        'HIGH',
        this.weight('database-change', 15),
        '变更摘要或提交信息包含数据库/schema/迁移等关键字',
        'request.changeSummary/changeItems',
        'SUFFICIENT',
      );
    }

    // Config change
    if (this.containsConfigChange(request)) {
      score += this.addFactor(
        factors,
        '配置变更',
        'MEDIUM',
        this.weight('config-change', 8),
        '检测到配置项调整，存在参数失配风险',
        'request.changeItems',
        'SUFFICIENT',
      );
    }

    // Large change
    if (request.changeItems && request.changeItems.length > 10) {
      score += this.addFactor(
        factors,
        '变更规模较大',
        'MEDIUM',
        this.weight('large-change', 12),
        '提交数超过 10 条，回归面扩大',
        'request.changeItems',
        'SUFFICIENT',
      );
    }

    // Missing deployment history
    if (!evidence.deploymentHistoryAvailable) {
      score += this.addFactor(
        factors,
        '缺少发布历史证据',
        'MEDIUM',
        this.weight('missing-deployment-history', 8),
        evidence.deploymentHistoryEvidence,
        'request.changeItems',
        'INSUFFICIENT',
      );
    }

    // Active alerts
    if (evidence.activeAlerts) {
      score += this.addFactor(
        factors,
        '发布前存在活跃告警',
        'HIGH',
        this.weight('active-alerts', 20),
        evidence.activeAlertEvidence,
        'queryPrometheusAlerts',
        'SUFFICIENT',
      );
    }

    // Missing runbook
    if (!evidence.rollbackRunbookFound) {
      score += this.addFactor(
        factors,
        '缺少可用回滚手册',
        'HIGH',
        this.weight('missing-runbook', 15),
        evidence.rollbackRunbookEvidence,
        'queryInternalDocs',
        'INSUFFICIENT',
      );
    }

    // Recent incident
    if (evidence.recentIncidentFound) {
      score += this.addFactor(
        factors,
        '存在历史同类故障',
        'MEDIUM',
        this.weight('recent-incident', 10),
        evidence.recentIncidentEvidence,
        'queryInternalDocs',
        'SUFFICIENT',
      );
    }

    // Default low-risk factor if no risks found
    if (factors.length === 0) {
      factors.push({
        factor: '未发现显著风险信号',
        level: 'LOW',
        scoreImpact: 0,
        evidence: '当前输入与证据未命中高风险规则。',
        evidenceSource: 'rule-engine',
        evidenceStatus: 'SUFFICIENT',
      });
    }

    // Clamp score to 0-100
    score = Math.min(100, Math.max(0, score));

    const riskLevel = this.resolveRiskLevel(score);
    const releaseStrategy = this.resolveReleaseStrategy(riskLevel);
    const decision = this.resolveDecision(riskLevel, evidence.activeAlerts);

    logger.info(
      { service: request.serviceName, env: request.environment, score, level: riskLevel },
      '发布预检评分完成',
    );

    return {
      riskScore: score,
      riskLevel,
      releaseStrategy,
      decision,
      riskFactors: factors,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private addFactor(
    factors: RiskFactor[],
    factorName: string,
    level: string,
    impact: number,
    evidence: string,
    source: string,
    evidenceStatus: string,
  ): number {
    factors.push({
      factor: factorName,
      level,
      scoreImpact: impact,
      evidence,
      evidenceSource: source,
      evidenceStatus,
    });
    return impact;
  }

  private weight(key: string, fallback: number): number {
    const configKey = WEIGHT_KEY_MAP[key];
    if (!configKey) return fallback;
    return this.config.release.precheck.scoreWeights[configKey] ?? fallback;
  }

  private isPeakWindow(releaseWindow: string | undefined): boolean {
    if (!releaseWindow) return false;
    const normalized = releaseWindow.replace('：', ':');
    return /\b(09|1\d|20):\d{2}\b/.test(normalized);
  }

  private containsDatabaseChange(request: ReleasePrecheckRequest): boolean {
    const summary = this.safeLower(request.changeSummary);
    if (this.containsAny(summary, '数据库', 'schema', 'ddl', 'migration', 'migrate', '索引', '表结构')) {
      return true;
    }
    if (!request.changeItems) return false;
    return request.changeItems.some(
      (item) =>
        item.databaseChange ||
        this.containsAny(this.safeLower(item.title), 'schema', 'ddl', 'migration', '数据库', '表') ||
        this.containsAny(this.safeLower(item.riskTag), 'database', 'db', 'schema'),
    );
  }

  private containsConfigChange(request: ReleasePrecheckRequest): boolean {
    const summary = this.safeLower(request.changeSummary);
    if (this.containsAny(summary, '配置', 'config', 'yaml', 'properties', '环境变量')) {
      return true;
    }
    if (!request.changeItems) return false;
    return request.changeItems.some(
      (item) =>
        item.configChange ||
        this.containsAny(this.safeLower(item.title), 'config', '配置', '参数') ||
        this.containsAny(this.safeLower(item.riskTag), 'config', '参数'),
    );
  }

  private safeLower(input: string | undefined): string {
    return input?.toLowerCase() ?? '';
  }

  private containsAny(source: string, ...keys: string[]): boolean {
    return keys.some((key) => source.includes(key.toLowerCase()));
  }

  private resolveRiskLevel(score: number): string {
    if (score >= 70) return 'HIGH';
    if (score >= 40) return 'MEDIUM';
    return 'LOW';
  }

  private resolveReleaseStrategy(riskLevel: string): string {
    switch (riskLevel) {
      case 'HIGH':
        return '建议暂停全量发布，先修复高风险项后再评审。';
      case 'MEDIUM':
        return '建议灰度发布（5%-20%-50%-100%），每阶段至少观察 10-15 分钟。';
      default:
        return '建议分批全量发布，保留可快速回滚能力。';
    }
  }

  private resolveDecision(riskLevel: string, hasActiveAlerts: boolean): string {
    if (riskLevel === 'HIGH' || hasActiveAlerts) return 'NO_GO';
    return 'GO';
  }
}
