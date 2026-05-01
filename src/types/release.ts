/**
 * Release precheck request DTO.
 * Represents the input for a release pre-check evaluation.
 */
export interface ReleasePrecheckRequest {
  /** Target service name */
  serviceName: string;
  /** Deployment environment (e.g. prod, staging) */
  environment: string;
  /** Summary of changes being released */
  changeSummary: string;
  /** Release time window (e.g. "14:00-16:00") */
  releaseWindow: string;
  /** Whether this is an emergency release */
  emergencyRelease: boolean;
  /** Operator performing the release */
  operator: string;
  /** List of individual change items */
  changeItems: ChangeItem[];
}

/**
 * Individual change item within a release.
 */
export interface ChangeItem {
  /** Git commit ID */
  commitId: string;
  /** Commit title / summary */
  title: string;
  /** Module or component touched by this change */
  touchedModule: string;
  /** Risk tag (e.g. database, config, high-risk) */
  riskTag: string;
  /** Whether this change involves database modifications */
  databaseChange: boolean;
  /** Whether this change involves configuration modifications */
  configChange: boolean;
}

/**
 * Precheck result DTO.
 * Full output of a release pre-check evaluation.
 */
export interface PrecheckResult {
  /** Unique result identifier */
  id: string;
  /** Target service name */
  serviceName: string;
  /** Deployment environment */
  environment: string;
  /** Summary of changes */
  changeSummary: string;
  /** Release time window */
  releaseWindow: string;

  /** Overall risk score (0-100) */
  riskScore: number;
  /** Risk level: LOW, MEDIUM, HIGH */
  riskLevel: string;
  /** Individual risk factors contributing to the score */
  riskFactors: RiskFactor[];

  /** Recommended release strategy */
  releaseStrategy: string;
  /** Metrics to watch after release */
  watchMetrics: WatchMetric[];
  /** Ordered rollback steps */
  rollbackPlan: RollbackStep[];

  /** Final decision: GO or NO_GO */
  decision: string;
  /** Human-readable summary */
  summary: string;
  /** Chain of evidence supporting the decision */
  evidenceChain: string[];
  /** Full report in markdown format */
  reportMarkdown: string;

  /** Precheck status (e.g. completed, pending) */
  status: string;
  /** Post-release feedback if submitted */
  feedback: PrecheckFeedbackRequest | null;

  /** Creation timestamp (ISO string) */
  createdAt: string;
  /** Last update timestamp (ISO string) */
  updatedAt: string;
}

/**
 * Individual risk factor contributing to the risk score.
 */
export interface RiskFactor {
  /** Factor name / description */
  factor: string;
  /** Severity level: LOW, MEDIUM, HIGH */
  level: string;
  /** Score impact (points added) */
  scoreImpact: number;
  /** Evidence text supporting this factor */
  evidence: string;
  /** Source of the evidence (e.g. request field, tool name) */
  evidenceSource: string;
  /** Sufficiency status: SUFFICIENT or INSUFFICIENT */
  evidenceStatus: string;
}

/**
 * Post-release observation metric to monitor.
 */
export interface WatchMetric {
  /** Metric name (e.g. error_rate, latency_p99) */
  name: string;
  /** Alert threshold value */
  threshold: string;
  /** Reason for monitoring this metric */
  reason: string;
  /** Data source (e.g. prometheus, cls) */
  source: string;
}

/**
 * Ordered rollback step in the rollback plan.
 */
export interface RollbackStep {
  /** Step order (1-based) */
  stepOrder: number;
  /** Action to perform */
  action: string;
  /** Person or team responsible */
  owner: string;
  /** Expected time to complete */
  expectedTime: string;
  /** Fallback action if this step fails */
  fallback: string;
}

/**
 * Post-release feedback request DTO.
 * Used to record actual outcome after a release.
 */
export interface PrecheckFeedbackRequest {
  /** Whether an incident occurred post-release */
  incidentOccurred: boolean;
  /** Severity of the incident if any */
  incidentSeverity: string;
  /** Scope of impact */
  impactScope: string;
  /** Whether rollback was triggered */
  rollbackTriggered: boolean;
  /** Feedback summary */
  summary: string;
  /** Reviewer providing the feedback */
  reviewer: string;
}

/**
 * Weight change audit record for release precheck scoring.
 */
export interface ReleaseWeightAuditRecord {
  /** Unique record identifier */
  id: string;
  /** Timestamp of the weight change (ISO string) */
  changedAt: string;
  /** Operator who made the change */
  operator: string;
  /** Weights before the change */
  beforeWeights: Record<string, number>;
  /** Updated weight values (delta) */
  updatedWeights: Record<string, number>;
  /** Weights after the change */
  afterWeights: Record<string, number>;
}
