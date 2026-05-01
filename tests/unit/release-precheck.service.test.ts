/**
 * Unit tests for release precheck services
 *
 * Covers:
 * - RiskScoringService: weighted scoring with 10 risk factors, edge cases
 * - ReleaseReportService: summary and markdown report generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RiskScoringService } from '../../src/services/risk-scoring.service.js';
import { ReleaseReportService } from '../../src/services/release-report.service.js';
import type { AppConfig } from '../../src/config/index.js';
import type { ReleasePrecheckRequest, PrecheckResult } from '../../src/types/release.js';
import type { ReleaseEvidence, RiskScoreResult } from '../../src/types/evidence.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AppConfig['release']['precheck']['scoreWeights']>): AppConfig {
  return {
    release: {
      precheck: {
        enabled: true,
        defaultTimeout: 900000,
        historyFile: './history.json',
        weightAuditFile: './audit.json',
        scoreWeights: {
          production: 15,
          peakWindow: 10,
          emergency: 20,
          databaseChange: 15,
          configChange: 8,
          largeChange: 12,
          activeAlerts: 20,
          missingRunbook: 15,
          recentIncident: 10,
          missingDeploymentHistory: 8,
          ...overrides,
        },
        requiredEvidence: {
          deploymentHistory: true,
          serviceBaseline: true,
          rollbackRunbook: true,
        },
      },
    },
  } as AppConfig;
}

function makeRequest(overrides?: Partial<ReleasePrecheckRequest>): ReleasePrecheckRequest {
  return {
    serviceName: 'test-service',
    environment: 'staging',
    changeSummary: 'fix typo',
    releaseWindow: '02:00-04:00',
    emergencyRelease: false,
    operator: 'dev',
    changeItems: [],
    ...overrides,
  };
}

function makeEvidence(overrides?: Partial<ReleaseEvidence>): ReleaseEvidence {
  return {
    activeAlerts: false,
    activeAlertCount: 0,
    activeAlertEvidence: '',
    rollbackRunbookFound: true,
    rollbackRunbookEvidence: '',
    deploymentHistoryAvailable: true,
    deploymentHistoryEvidence: '',
    recentIncidentFound: false,
    recentIncidentEvidence: '',
    evidenceChain: [],
    ...overrides,
  };
}

function makeResult(overrides?: Partial<PrecheckResult>): PrecheckResult {
  return {
    id: 'result-1',
    serviceName: 'test-service',
    environment: 'staging',
    changeSummary: 'fix typo',
    releaseWindow: '02:00-04:00',
    riskScore: 0,
    riskLevel: 'LOW',
    riskFactors: [],
    releaseStrategy: '',
    watchMetrics: [],
    rollbackPlan: [],
    decision: 'GO',
    summary: '',
    evidenceChain: [],
    reportMarkdown: '',
    status: 'completed',
    feedback: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ===========================================================================
// RiskScoringService
// ===========================================================================

describe('RiskScoringService', () => {
  let service: RiskScoringService;

  beforeEach(() => {
    service = new RiskScoringService(makeConfig());
  });

  // -------------------------------------------------------------------------
  // Basic scoring
  // -------------------------------------------------------------------------

  describe('score', () => {
    it('should return score 0 with default low-risk factor when no risks are present', () => {
      const result = service.score(makeRequest(), makeEvidence());

      expect(result.riskScore).toBe(0);
      expect(result.riskLevel).toBe('LOW');
      expect(result.decision).toBe('GO');
      expect(result.riskFactors).toHaveLength(1);
      expect(result.riskFactors[0].factor).toBe('未发现显著风险信号');
      expect(result.riskFactors[0].scoreImpact).toBe(0);
    });

    it('should return LOW risk level and GO decision for low scores', () => {
      // Only production env (15 points) -> MEDIUM boundary is 40
      const result = service.score(
        makeRequest({ environment: 'prod' }),
        makeEvidence(),
      );

      expect(result.riskScore).toBe(15);
      expect(result.riskLevel).toBe('LOW');
      expect(result.decision).toBe('GO');
    });
  });

  // -------------------------------------------------------------------------
  // Individual risk factors
  // -------------------------------------------------------------------------

  describe('risk factors', () => {
    it('should add production environment factor for "prod"', () => {
      const result = service.score(
        makeRequest({ environment: 'prod' }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '生产环境变更');
      expect(factor).toBeDefined();
      expect(factor!.level).toBe('MEDIUM');
      expect(factor!.scoreImpact).toBe(15);
      expect(factor!.evidenceSource).toBe('request.environment');
    });

    it('should add production environment factor for "production" (case-insensitive)', () => {
      const result = service.score(
        makeRequest({ environment: 'Production' }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '生产环境变更');
      expect(factor).toBeDefined();
    });

    it('should not add production factor for staging', () => {
      const result = service.score(
        makeRequest({ environment: 'staging' }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '生产环境变更');
      expect(factor).toBeUndefined();
    });

    it('should add peak window factor for hours 09-20', () => {
      const result = service.score(
        makeRequest({ releaseWindow: '14:00-16:00' }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '高峰时段发布');
      expect(factor).toBeDefined();
      expect(factor!.scoreImpact).toBe(10);
    });

    it('should handle full-width colon in peak window', () => {
      const result = service.score(
        makeRequest({ releaseWindow: '14：00-16：00' }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '高峰时段发布');
      expect(factor).toBeDefined();
    });

    it('should not add peak window factor for off-peak hours', () => {
      const result = service.score(
        makeRequest({ releaseWindow: '02:00-04:00' }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '高峰时段发布');
      expect(factor).toBeUndefined();
    });

    it('should not add peak window factor when releaseWindow is undefined', () => {
      const result = service.score(
        makeRequest({ releaseWindow: undefined as any }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '高峰时段发布');
      expect(factor).toBeUndefined();
    });

    it('should add emergency release factor', () => {
      const result = service.score(
        makeRequest({ emergencyRelease: true }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '紧急发布');
      expect(factor).toBeDefined();
      expect(factor!.level).toBe('HIGH');
      expect(factor!.scoreImpact).toBe(20);
    });

    it('should detect database change from changeSummary keywords', () => {
      const result = service.score(
        makeRequest({ changeSummary: 'add migration for user table' }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '数据库相关变更');
      expect(factor).toBeDefined();
      expect(factor!.scoreImpact).toBe(15);
    });

    it('should detect database change from changeItems with databaseChange flag', () => {
      const result = service.score(
        makeRequest({
          changeItems: [
            { commitId: 'abc', title: 'update user', touchedModule: 'user', riskTag: '', databaseChange: true, configChange: false },
          ],
        }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '数据库相关变更');
      expect(factor).toBeDefined();
    });

    it('should detect database change from changeItems riskTag', () => {
      const result = service.score(
        makeRequest({
          changeItems: [
            { commitId: 'abc', title: 'fix bug', touchedModule: 'user', riskTag: 'database', databaseChange: false, configChange: false },
          ],
        }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '数据库相关变更');
      expect(factor).toBeDefined();
    });

    it('should detect config change from changeSummary', () => {
      const result = service.score(
        makeRequest({ changeSummary: 'update config for redis' }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '配置变更');
      expect(factor).toBeDefined();
      expect(factor!.scoreImpact).toBe(8);
    });

    it('should detect config change from changeItems configChange flag', () => {
      const result = service.score(
        makeRequest({
          changeItems: [
            { commitId: 'abc', title: 'tweak', touchedModule: 'app', riskTag: '', databaseChange: false, configChange: true },
          ],
        }),
        makeEvidence(),
      );

      const factor = result.riskFactors.find((f) => f.factor === '配置变更');
      expect(factor).toBeDefined();
    });

    it('should add large change factor when changeItems > 10', () => {
      const items = Array.from({ length: 11 }, (_, i) => ({
        commitId: `c${i}`,
        title: `change ${i}`,
        touchedModule: 'mod',
        riskTag: '',
        databaseChange: false,
        configChange: false,
      }));

      const result = service.score(makeRequest({ changeItems: items }), makeEvidence());

      const factor = result.riskFactors.find((f) => f.factor === '变更规模较大');
      expect(factor).toBeDefined();
      expect(factor!.scoreImpact).toBe(12);
    });

    it('should not add large change factor when changeItems <= 10', () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        commitId: `c${i}`,
        title: `change ${i}`,
        touchedModule: 'mod',
        riskTag: '',
        databaseChange: false,
        configChange: false,
      }));

      const result = service.score(makeRequest({ changeItems: items }), makeEvidence());

      const factor = result.riskFactors.find((f) => f.factor === '变更规模较大');
      expect(factor).toBeUndefined();
    });

    it('should add active alerts factor', () => {
      const result = service.score(
        makeRequest(),
        makeEvidence({ activeAlerts: true, activeAlertCount: 3, activeAlertEvidence: '3 alerts found' }),
      );

      const factor = result.riskFactors.find((f) => f.factor === '发布前存在活跃告警');
      expect(factor).toBeDefined();
      expect(factor!.level).toBe('HIGH');
      expect(factor!.scoreImpact).toBe(20);
    });

    it('should add missing runbook factor', () => {
      const result = service.score(
        makeRequest(),
        makeEvidence({ rollbackRunbookFound: false, rollbackRunbookEvidence: 'no runbook' }),
      );

      const factor = result.riskFactors.find((f) => f.factor === '缺少可用回滚手册');
      expect(factor).toBeDefined();
      expect(factor!.level).toBe('HIGH');
      expect(factor!.scoreImpact).toBe(15);
    });

    it('should add missing deployment history factor', () => {
      const result = service.score(
        makeRequest(),
        makeEvidence({ deploymentHistoryAvailable: false, deploymentHistoryEvidence: 'no history' }),
      );

      const factor = result.riskFactors.find((f) => f.factor === '缺少发布历史证据');
      expect(factor).toBeDefined();
      expect(factor!.scoreImpact).toBe(8);
    });

    it('should add recent incident factor', () => {
      const result = service.score(
        makeRequest(),
        makeEvidence({ recentIncidentFound: true, recentIncidentEvidence: 'similar issue last week' }),
      );

      const factor = result.riskFactors.find((f) => f.factor === '存在历史同类故障');
      expect(factor).toBeDefined();
      expect(factor!.scoreImpact).toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // Risk level thresholds
  // -------------------------------------------------------------------------

  describe('risk level thresholds', () => {
    it('should classify score >= 70 as HIGH', () => {
      // prod(15) + peak(10) + emergency(20) + activeAlerts(20) + missingRunbook(15) = 80
      const result = service.score(
        makeRequest({ environment: 'prod', releaseWindow: '10:00-12:00', emergencyRelease: true }),
        makeEvidence({ activeAlerts: true, activeAlertCount: 2, activeAlertEvidence: 'alerts', rollbackRunbookFound: false, rollbackRunbookEvidence: 'no runbook' }),
      );

      expect(result.riskScore).toBeGreaterThanOrEqual(70);
      expect(result.riskLevel).toBe('HIGH');
      expect(result.decision).toBe('NO_GO');
    });

    it('should classify score 40-69 as MEDIUM', () => {
      // prod(15) + emergency(20) + missingRunbook(15) = 50
      const result = service.score(
        makeRequest({ environment: 'prod', emergencyRelease: true }),
        makeEvidence({ rollbackRunbookFound: false, rollbackRunbookEvidence: 'no runbook' }),
      );

      expect(result.riskScore).toBeGreaterThanOrEqual(40);
      expect(result.riskScore).toBeLessThan(70);
      expect(result.riskLevel).toBe('MEDIUM');
    });

    it('should classify score < 40 as LOW', () => {
      // prod(15) only
      const result = service.score(
        makeRequest({ environment: 'prod' }),
        makeEvidence(),
      );

      expect(result.riskScore).toBeLessThan(40);
      expect(result.riskLevel).toBe('LOW');
    });
  });

  // -------------------------------------------------------------------------
  // Decision logic
  // -------------------------------------------------------------------------

  describe('decision', () => {
    it('should return NO_GO when risk level is HIGH', () => {
      const result = service.score(
        makeRequest({ environment: 'prod', releaseWindow: '10:00-12:00', emergencyRelease: true }),
        makeEvidence({ activeAlerts: true, activeAlertCount: 1, activeAlertEvidence: 'a', rollbackRunbookFound: false, rollbackRunbookEvidence: 'b' }),
      );

      expect(result.decision).toBe('NO_GO');
    });

    it('should return NO_GO when active alerts are present even if risk level is not HIGH', () => {
      // LOW risk + active alerts -> NO_GO
      const result = service.score(
        makeRequest(),
        makeEvidence({ activeAlerts: true, activeAlertCount: 1, activeAlertEvidence: 'alert' }),
      );

      // Score is just 20 (activeAlerts), level is LOW, but decision should be NO_GO
      expect(result.riskLevel).toBe('LOW');
      expect(result.decision).toBe('NO_GO');
    });

    it('should return GO when risk level is LOW and no active alerts', () => {
      const result = service.score(makeRequest(), makeEvidence());
      expect(result.decision).toBe('GO');
    });
  });

  // -------------------------------------------------------------------------
  // Custom weights
  // -------------------------------------------------------------------------

  describe('custom weights', () => {
    it('should use custom weight for production', () => {
      const customService = new RiskScoringService(makeConfig({ production: 30 }));

      const result = customService.score(
        makeRequest({ environment: 'prod' }),
        makeEvidence(),
      );

      expect(result.riskScore).toBe(30);
      const factor = result.riskFactors.find((f) => f.factor === '生产环境变更');
      expect(factor!.scoreImpact).toBe(30);
    });

    it('should use custom weight for emergency', () => {
      const customService = new RiskScoringService(makeConfig({ emergency: 50 }));

      const result = customService.score(
        makeRequest({ emergencyRelease: true }),
        makeEvidence(),
      );

      expect(result.riskScore).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // Score clamping
  // -------------------------------------------------------------------------

  describe('score clamping', () => {
    it('should clamp score to maximum of 100', () => {
      const customService = new RiskScoringService(makeConfig({
        production: 50,
        peakWindow: 50,
        emergency: 50,
        databaseChange: 50,
        configChange: 50,
        largeChange: 50,
        activeAlerts: 50,
        missingRunbook: 50,
        recentIncident: 50,
        missingDeploymentHistory: 50,
      }));

      const items = Array.from({ length: 11 }, (_, i) => ({
        commitId: `c${i}`,
        title: `schema migration ${i}`,
        touchedModule: 'mod',
        riskTag: 'database',
        databaseChange: true,
        configChange: true,
      }));

      const result = customService.score(
        makeRequest({
          environment: 'prod',
          releaseWindow: '10:00-12:00',
          emergencyRelease: true,
          changeSummary: 'database migration and config change',
          changeItems: items,
        }),
        makeEvidence({
          activeAlerts: true,
          activeAlertCount: 5,
          activeAlertEvidence: 'alerts',
          rollbackRunbookFound: false,
          rollbackRunbookEvidence: 'no runbook',
          deploymentHistoryAvailable: false,
          deploymentHistoryEvidence: 'no history',
          recentIncidentFound: true,
          recentIncidentEvidence: 'incident',
        }),
      );

      expect(result.riskScore).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // Release strategy
  // -------------------------------------------------------------------------

  describe('release strategy', () => {
    it('should recommend pause for HIGH risk', () => {
      const result = service.score(
        makeRequest({ environment: 'prod', releaseWindow: '10:00-12:00', emergencyRelease: true }),
        makeEvidence({ activeAlerts: true, activeAlertCount: 1, activeAlertEvidence: 'a', rollbackRunbookFound: false, rollbackRunbookEvidence: 'b' }),
      );

      expect(result.riskLevel).toBe('HIGH');
      expect(result.releaseStrategy).toContain('暂停全量发布');
    });

    it('should recommend canary for MEDIUM risk', () => {
      const result = service.score(
        makeRequest({ environment: 'prod', emergencyRelease: true }),
        makeEvidence({ rollbackRunbookFound: false, rollbackRunbookEvidence: 'no runbook' }),
      );

      expect(result.riskLevel).toBe('MEDIUM');
      expect(result.releaseStrategy).toContain('灰度发布');
    });

    it('should recommend batch release for LOW risk', () => {
      const result = service.score(makeRequest(), makeEvidence());

      expect(result.riskLevel).toBe('LOW');
      expect(result.releaseStrategy).toContain('分批全量发布');
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty changeItems array', () => {
      const result = service.score(
        makeRequest({ changeItems: [] }),
        makeEvidence(),
      );

      expect(result.riskScore).toBe(0);
      expect(result.riskFactors).toHaveLength(1);
    });

    it('should handle all evidence flags in favorable state', () => {
      const result = service.score(makeRequest(), makeEvidence());

      // No risk factors triggered
      expect(result.riskFactors[0].factor).toBe('未发现显著风险信号');
      expect(result.decision).toBe('GO');
    });

    it('should handle all evidence flags in unfavorable state', () => {
      const result = service.score(
        makeRequest({
          environment: 'prod',
          releaseWindow: '10:00-12:00',
          emergencyRelease: true,
          changeSummary: 'database schema migration and config yaml update',
        }),
        makeEvidence({
          activeAlerts: true,
          activeAlertCount: 3,
          activeAlertEvidence: 'alerts found',
          rollbackRunbookFound: false,
          rollbackRunbookEvidence: 'no runbook',
          deploymentHistoryAvailable: false,
          deploymentHistoryEvidence: 'no history',
          recentIncidentFound: true,
          recentIncidentEvidence: 'recent incident',
        }),
      );

      // Should have many risk factors
      expect(result.riskFactors.length).toBeGreaterThanOrEqual(6);
      expect(result.riskLevel).toBe('HIGH');
      expect(result.decision).toBe('NO_GO');
    });

    it('should handle case-insensitive environment comparison', () => {
      const r1 = service.score(makeRequest({ environment: 'PROD' }), makeEvidence());
      const r2 = service.score(makeRequest({ environment: 'Prod' }), makeEvidence());
      const r3 = service.score(makeRequest({ environment: 'prod' }), makeEvidence());

      expect(r1.riskScore).toBe(r2.riskScore);
      expect(r2.riskScore).toBe(r3.riskScore);
    });

    it('should handle undefined changeItems', () => {
      const result = service.score(
        makeRequest({ changeItems: undefined as any }),
        makeEvidence(),
      );

      expect(result.riskScore).toBe(0);
    });
  });
});

// ===========================================================================
// ReleaseReportService
// ===========================================================================

describe('ReleaseReportService', () => {
  let service: ReleaseReportService;

  beforeEach(() => {
    service = new ReleaseReportService();
  });

  // -------------------------------------------------------------------------
  // buildSummary
  // -------------------------------------------------------------------------

  describe('buildSummary', () => {
    it('should include service name, risk score, risk level, and decision', () => {
      const result = makeResult({
        serviceName: 'my-service',
        riskScore: 25,
        riskLevel: 'LOW',
        decision: 'GO',
        riskFactors: [],
      });
      const evidence = makeEvidence();

      const summary = service.buildSummary(result, evidence);

      expect(summary).toContain('my-service');
      expect(summary).toContain('25');
      expect(summary).toContain('LOW');
      expect(summary).toContain('GO');
    });

    it('should list top 2 risk factors sorted by scoreImpact', () => {
      const result = makeResult({
        riskFactors: [
          { factor: 'factor-a', level: 'LOW', scoreImpact: 5, evidence: '', evidenceSource: '', evidenceStatus: '' },
          { factor: 'factor-c', level: 'HIGH', scoreImpact: 20, evidence: '', evidenceSource: '', evidenceStatus: '' },
          { factor: 'factor-b', level: 'MEDIUM', scoreImpact: 10, evidence: '', evidenceSource: '', evidenceStatus: '' },
        ],
      });
      const evidence = makeEvidence();

      const summary = service.buildSummary(result, evidence);

      expect(summary).toContain('factor-c');
      expect(summary).toContain('factor-b');
      // factor-a should not be in the summary (only top 2)
    });

    it('should show active alert count when alerts are present', () => {
      const result = makeResult({ riskFactors: [] });
      const evidence = makeEvidence({ activeAlerts: true, activeAlertCount: 5 });

      const summary = service.buildSummary(result, evidence);

      expect(summary).toContain('存在 5 条活跃告警');
    });

    it('should show no alerts message when no alerts', () => {
      const result = makeResult({ riskFactors: [] });
      const evidence = makeEvidence({ activeAlerts: false });

      const summary = service.buildSummary(result, evidence);

      expect(summary).toContain('未检测到活跃告警');
    });

    it('should use fallback text when no risk factors', () => {
      const result = makeResult({ riskFactors: [] });
      const evidence = makeEvidence();

      const summary = service.buildSummary(result, evidence);

      expect(summary).toContain('未命中高风险规则');
    });
  });

  // -------------------------------------------------------------------------
  // buildMarkdown
  // -------------------------------------------------------------------------

  describe('buildMarkdown', () => {
    it('should contain all required sections', () => {
      const result = makeResult();
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('# 发布变更预检报告');
      expect(md).toContain('## 变更摘要');
      expect(md).toContain('## 风险评分与等级');
      expect(md).toContain('## 证据链');
      expect(md).toContain('## 风险因子');
      expect(md).toContain('## 发布策略建议');
      expect(md).toContain('## 观测指标与阈值建议');
      expect(md).toContain('## 回滚预案');
      expect(md).toContain('## 审批摘要');
    });

    it('should include change summary details', () => {
      const result = makeResult({
        serviceName: 'order-service',
        environment: 'prod',
        releaseWindow: '14:00-16:00',
        changeSummary: 'fix payment bug',
      });
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('order-service');
      expect(md).toContain('prod');
      expect(md).toContain('14:00-16:00');
      expect(md).toContain('fix payment bug');
    });

    it('should include risk score, level, and decision', () => {
      const result = makeResult({
        riskScore: 55,
        riskLevel: 'MEDIUM',
        decision: 'GO',
      });
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('riskScore: 55');
      expect(md).toContain('riskLevel: MEDIUM');
      expect(md).toContain('decision: GO');
    });

    it('should format risk factors with level, impact, and evidence', () => {
      const result = makeResult({
        riskFactors: [
          {
            factor: 'test-factor',
            level: 'HIGH',
            scoreImpact: 20,
            evidence: 'some evidence text',
            evidenceSource: 'testSource',
            evidenceStatus: 'SUFFICIENT',
          },
        ],
      });
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('test-factor');
      expect(md).toContain('level=HIGH');
      expect(md).toContain('impact=20');
      expect(md).toContain('evidenceStatus=SUFFICIENT');
      expect(md).toContain('some evidence text');
      expect(md).toContain('testSource');
    });

    it('should format watch metrics', () => {
      const result = makeResult({
        watchMetrics: [
          { name: 'error_rate', threshold: '> 5%', reason: 'high error rate', source: 'prometheus' },
        ],
      });
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('error_rate');
      expect(md).toContain('> 5%');
      expect(md).toContain('high error rate');
      expect(md).toContain('prometheus');
    });

    it('should format rollback plan steps', () => {
      const result = makeResult({
        rollbackPlan: [
          { stepOrder: 1, action: 'rollback deploy', owner: 'ops-team', expectedTime: '5min', fallback: 'manual intervention' },
        ],
      });
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('1. rollback deploy');
      expect(md).toContain('ops-team');
      expect(md).toContain('5min');
      expect(md).toContain('失败回退: manual intervention');
    });

    it('should show placeholder when evidence chain is empty', () => {
      const result = makeResult({ evidenceChain: [] });
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('暂无证据条目');
    });

    it('should list evidence chain items', () => {
      const result = makeResult({ evidenceChain: ['evidence-1', 'evidence-2'] });
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('- evidence-1');
      expect(md).toContain('- evidence-2');
    });

    it('should include the summary in the approval section', () => {
      const result = makeResult({ summary: 'all checks passed' });
      const evidence = makeEvidence();

      const md = service.buildMarkdown(result, evidence);

      expect(md).toContain('all checks passed');
    });
  });
});
