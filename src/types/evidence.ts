/**
 * Release evidence snapshot.
 * Captures external evidence gathered during a release pre-check.
 */
export interface ReleaseEvidence {
  /** Whether active alerts were found */
  activeAlerts: boolean;
  /** Number of active alerts */
  activeAlertCount: number;
  /** Evidence text for active alerts */
  activeAlertEvidence: string;

  /** Whether a rollback runbook was found */
  rollbackRunbookFound: boolean;
  /** Evidence text for rollback runbook lookup */
  rollbackRunbookEvidence: string;

  /** Whether deployment history is available */
  deploymentHistoryAvailable: boolean;
  /** Evidence text for deployment history */
  deploymentHistoryEvidence: string;

  /** Whether a recent similar incident was found */
  recentIncidentFound: boolean;
  /** Evidence text for recent incident */
  recentIncidentEvidence: string;

  /** Chain of all evidence collected */
  evidenceChain: string[];
}

/**
 * Release agent execution result.
 * Captures the output of the release pre-check agent pipeline.
 */
export interface ReleaseAgentExecutionResult {
  /** Planner agent output */
  plannerOutput: string;
  /** Executor agent output */
  executorOutput: string;
  /** Reporter agent output */
  reporterOutput: string;
  /** Combined summary */
  summary: string;
  /** Evidence chain collected during execution */
  evidenceChain: string[];
}

/**
 * Risk score output from the scoring engine.
 */
export interface RiskScoreResult {
  /** Overall risk score (0-100) */
  riskScore: number;
  /** Risk level: LOW, MEDIUM, HIGH */
  riskLevel: string;
  /** Recommended release strategy */
  releaseStrategy: string;
  /** Final decision: GO or NO_GO */
  decision: string;
  /** Individual risk factors */
  riskFactors: import('./release.js').RiskFactor[];
}
