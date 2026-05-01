/**
 * 发布预检规则评分引擎（第一版）
 *
 * Ported from Java RiskScoringService.java.
 *
 * Evaluates release risk based on 10 weighted scoring factors:
 * 1. Production environment
 * 2. Peak window (09:00-20:00)
 * 3. Emergency release
 * 4. Database change
 * 5. Config change
 * 6. Large change (>10 items)
 * 7. Active alerts
 * 8. Missing rollback runbook
 * 9. Recent similar incident
 * 10. Missing deployment history
 *
 * Weight overrides are read from config (release.precheck.scoreWeights).
 */

import pino from 'pino';
import type { ReleasePrecheckRequest } from '../types/release.js';
import type { ReleaseEvidence, RiskScoreResult } from '../types/evidence.js';
import type { RiskFactor } from '../types/release.js';
import type { AppConfig } from '../config/index.js';

const logger = pino({ name: 'risk-scoring-service' });

// ---------------------------------------------------------------------------
// Weight key mapping (hyphenated factor name -> camelCase config key)
// ---------------------------------------------------------------------------

const WEIGHT_KEY_MAP: Record<string, keyof AppConfig['release']['precheck']['scoreWeights']> = {
  'production': 'production',
  'peak-window': 'peakWindow',
  'emergency': 'emergency',
  'database-change': 'databaseChange',
  'config-change': 'configChange',
  'large-change': 'largeChange',
  'active-alerts': 'activeAlerts',
  'missing-runbook': 'missingRunbook',
  'recent-incident': 'recentIncident',
  'missing-deployment-history': 'missingDeploymentHistory',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeLower(input: string | null | undefined): string {
  return input == null ? '' : input.toLowerCase();
}

function containsAny(source: string, ...keys: string[]): boolean {
  const lower = source.toLowerCase();
  for (const key of keys) {
    if (lower.includes(key.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function addFactor(
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate release risk based on request and evidence.
 * Returns a RiskScoreResult with score, level, factors, strategy, and decision.
 */
export function score(
  request: ReleasePrecheckRequest,
  evidence: ReleaseEvidence,
  config: AppConfig,
): RiskScoreResult {
  const weights = config.release.precheck.scoreWeights;
  let totalScore = 0;
  const factors: RiskFactor[] = [];

  // Helper: resolve weight by hyphenated factor key
  const weight = (key: string, fallback: number): number => {
    const camelKey = WEIGHT_KEY_MAP[key];
    if (camelKey && camelKey in weights) {
      return (weights as Record<string, number>)[camelKey];
    }
    return fallback;
  };

  // 1. Production environment
  if (
    request.environment.toLowerCase() === 'prod' ||
    request.environment.toLowerCase() === 'production'
  ) {
    totalScore += addFactor(
      factors,
      '生产环境变更',
      'MEDIUM',
      weight('production', 15),
      '本次变更目标环境为生产环境',
      'request.environment',
      'SUFFICIENT',
    );
  }

  // 2. Peak window
  if (isPeakWindow(request.releaseWindow)) {
    totalScore += addFactor(
      factors,
      '高峰时段发布',
      'MEDIUM',
      weight('peak-window', 10),
      '发布窗口命中业务高峰时段（09:00-20:00）',
      'request.releaseWindow',
      'SUFFICIENT',
    );
  }

  // 3. Emergency release
  if (request.emergencyRelease === true) {
    totalScore += addFactor(
      factors,
      '紧急发布',
      'HIGH',
      weight('emergency', 20),
      '请求标记为紧急发布，发布准备时间较短',
      'request.emergencyRelease',
      'SUFFICIENT',
    );
  }

  // 4. Database change
  if (containsDatabaseChange(request)) {
    totalScore += addFactor(
      factors,
      '数据库相关变更',
      'HIGH',
      weight('database-change', 15),
      '变更摘要或提交信息包含数据库/schema/迁移等关键字',
      'request.changeSummary/changeItems',
      'SUFFICIENT',
    );
  }

  // 5. Config change
  if (containsConfigChange(request)) {
    totalScore += addFactor(
      factors,
      '配置变更',
      'MEDIUM',
      weight('config-change', 8),
      '检测到配置项调整，存在参数失配风险',
      'request.changeItems',
      'SUFFICIENT',
    );
  }

  // 6. Large change (>10 items)
  if (request.changeItems != null && request.changeItems.length > 10) {
    totalScore += addFactor(
      factors,
      '变更规模较大',
      'MEDIUM',
      weight('large-change', 12),
      '提交数超过 10 条，回归面扩大',
      'request.changeItems',
      'SUFFICIENT',
    );
  }

  // 7. Missing deployment history
  if (!evidence.deploymentHistoryAvailable) {
    totalScore += addFactor(
      factors,
      '缺少发布历史证据',
      'MEDIUM',
      weight('missing-deployment-history', 8),
      evidence.deploymentHistoryEvidence,
      'request.changeItems',
      'INSUFFICIENT',
    );
  }

  // 8. Active alerts
  if (evidence.activeAlerts) {
    totalScore += addFactor(
      factors,
      '发布前存在活跃告警',
      'HIGH',
      weight('active-alerts', 20),
      evidence.activeAlertEvidence,
      'queryPrometheusAlerts',
      'SUFFICIENT',
    );
  }

  // 9. Missing rollback runbook
  if (!evidence.rollbackRunbookFound) {
    totalScore += addFactor(
      factors,
      '缺少可用回滚手册',
      'HIGH',
      weight('missing-runbook', 15),
      evidence.rollbackRunbookEvidence,
      'queryInternalDocs',
      'INSUFFICIENT',
    );
  }

  // 10. Recent similar incident
  if (evidence.recentIncidentFound) {
    totalScore += addFactor(
      factors,
      '存在历史同类故障',
      'MEDIUM',
      weight('recent-incident', 10),
      evidence.recentIncidentEvidence,
      'queryInternalDocs',
      'SUFFICIENT',
    );
  }

  // If no factors matched, add a low-risk default factor
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

  // Clamp score to [0, 100]
  totalScore = Math.min(100, Math.max(0, totalScore));

  const riskLevel = resolveRiskLevel(totalScore);
  const releaseStrategy = resolveReleaseStrategy(riskLevel);
  const decision = resolveDecision(riskLevel, evidence.activeAlerts);

  logger.info(
    {
      service: request.serviceName,
      env: request.environment,
      score: totalScore,
      level: riskLevel,
    },
    '发布预检评分完成',
  );

  return {
    riskScore: totalScore,
    riskLevel,
    releaseStrategy,
    decision,
    riskFactors: factors,
  };
}

// ---------------------------------------------------------------------------
// Peak window detection
// ---------------------------------------------------------------------------

/**
 * Check if a release window falls within peak hours (09:00-20:00).
 * Normalizes full-width colons and matches against the pattern.
 */
export function isPeakWindow(releaseWindow: string | null | undefined): boolean {
  if (releaseWindow == null || releaseWindow.trim() === '') {
    return false;
  }
  const normalized = releaseWindow.replace(/：/g, ':');
  return /\b(09|1\d|20):\d{2}\b/.test(normalized);
}

// ---------------------------------------------------------------------------
// Database change detection
// ---------------------------------------------------------------------------

/**
 * Check if the request contains database-related changes.
 * Matches keywords in changeSummary, changeItem titles, riskTags, and databaseChange flag.
 */
export function containsDatabaseChange(request: ReleasePrecheckRequest): boolean {
  const summary = safeLower(request.changeSummary);
  if (
    containsAny(
      summary,
      '数据库',
      'schema',
      'ddl',
      'migration',
      'migrate',
      '索引',
      '表结构',
    )
  ) {
    return true;
  }

  if (request.changeItems == null) {
    return false;
  }

  return request.changeItems.some(
    (item) =>
      item.databaseChange === true ||
      containsAny(
        safeLower(item.title),
        'schema',
        'ddl',
        'migration',
        '数据库',
        '表',
      ) ||
      containsAny(safeLower(item.riskTag), 'database', 'db', 'schema'),
  );
}

// ---------------------------------------------------------------------------
// Config change detection
// ---------------------------------------------------------------------------

/**
 * Check if the request contains configuration-related changes.
 * Matches keywords in changeSummary, changeItem titles, riskTags, and configChange flag.
 */
export function containsConfigChange(request: ReleasePrecheckRequest): boolean {
  const summary = safeLower(request.changeSummary);
  if (
    containsAny(summary, '配置', 'config', 'yaml', 'properties', '环境变量')
  ) {
    return true;
  }

  if (request.changeItems == null) {
    return false;
  }

  return request.changeItems.some(
    (item) =>
      item.configChange === true ||
      containsAny(safeLower(item.title), 'config', '配置', '参数') ||
      containsAny(safeLower(item.riskTag), 'config', '参数'),
  );
}

// ---------------------------------------------------------------------------
// Risk level resolution
// ---------------------------------------------------------------------------

/**
 * Resolve risk level from numeric score.
 * HIGH >= 70, MEDIUM >= 40, LOW < 40.
 */
export function resolveRiskLevel(score: number): string {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

// ---------------------------------------------------------------------------
// Release strategy resolution
// ---------------------------------------------------------------------------

/**
 * Resolve human-readable release strategy recommendation based on risk level.
 */
export function resolveReleaseStrategy(riskLevel: string): string {
  switch (riskLevel) {
    case 'HIGH':
      return '建议暂停全量发布，先修复高风险项后再评审。';
    case 'MEDIUM':
      return '建议灰度发布（5%-20%-50%-100%），每阶段至少观察 10-15 分钟。';
    default:
      return '建议分批全量发布，保留可快速回滚能力。';
  }
}

// ---------------------------------------------------------------------------
// Decision resolution
// ---------------------------------------------------------------------------

/**
 * Resolve final GO / NO_GO decision.
 * HIGH risk or active alerts => NO_GO, otherwise GO.
 */
export function resolveDecision(
  riskLevel: string,
  hasActiveAlerts: boolean,
): string {
  if (riskLevel === 'HIGH' || hasActiveAlerts) {
    return 'NO_GO';
  }
  return 'GO';
}
