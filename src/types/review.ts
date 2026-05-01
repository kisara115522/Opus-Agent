/**
 * Code review request DTO.
 * Represents input for an automated code review.
 */
export interface CodeReviewRequest {
  /** Local project path to review */
  projectPath: string;
  /** Base ref for comparison (e.g. main, HEAD~1) */
  baseRef: string;
  /** Head ref to review (defaults to HEAD) */
  headRef: string;
  /** Whether to include uncommitted working tree changes */
  includeUncommitted: boolean;
  /** User explicitly granted permission to read local Git info */
  permissionGranted: boolean;
  /** Operator performing the review */
  operator: string;
  /** Additional notes or context */
  notes: string;
}

/**
 * Code review result DTO.
 * Full output of a code review evaluation.
 */
export interface CodeReviewResult {
  /** Unique result identifier */
  id: string;
  /** Reviewed project path */
  projectPath: string;
  /** Base ref used for comparison */
  baseRef: string;
  /** Head ref reviewed */
  headRef: string;
  /** Commit range description (e.g. "abc1234..def5678") */
  commitRange: string;
  /** Total number of commits reviewed */
  totalCommits: number;
  /** Total number of changed files */
  totalChangedFiles: number;
  /** Overall risk score (0-100) */
  riskScore: number;
  /** Risk level: LOW, MEDIUM, HIGH */
  riskLevel: string;
  /** Final decision: GO or NO_GO */
  decision: string;
  /** Human-readable summary */
  summary: string;
  /** Full report in markdown format */
  reportMarkdown: string;
  /** Review status (e.g. completed, pending) */
  status: string;
  /** Review timestamp (ISO string) */
  reviewedAt: string;
  /** Operator who requested the review */
  operator: string;
  /** Additional notes */
  notes: string;
  /** Agent mode used (e.g. planner-reviewer-judge) */
  agentMode: string;
  /** Planner agent output */
  plannerOutput: string;
  /** Reviewer agent output */
  reviewerOutput: string;
  /** Judge agent output */
  judgeOutput: string;
  /** Final agent summary */
  agentSummary: string;
  /** Commits included in the review */
  commits: CodeReviewCommit[];
  /** Risk findings identified */
  findings: CodeReviewFinding[];
  /** RAG-sourced incident/interception evidences */
  incidentEvidences: CodeReviewIncidentEvidence[];
  /** List of changed file paths */
  changedFiles: string[];
  /** Chain of evidence supporting the decision */
  evidenceChain: string[];
}

/**
 * Individual risk finding from code review.
 */
export interface CodeReviewFinding {
  /** Rule key that triggered this finding */
  ruleKey: string;
  /** Finding title */
  title: string;
  /** Severity: LOW, MEDIUM, HIGH, CRITICAL */
  severity: string;
  /** Score impact (points added) */
  scoreImpact: number;
  /** File path where the finding was detected */
  filePath: string;
  /** Evidence text */
  evidence: string;
  /** Recommended remediation */
  recommendation: string;
  /** Source of the finding (e.g. rule-engine, agent) */
  source: string;
}

/**
 * Git commit summary included in a code review.
 */
export interface CodeReviewCommit {
  /** Commit SHA */
  commitId: string;
  /** Commit author */
  author: string;
  /** Commit timestamp (ISO string) */
  committedAt: string;
  /** Commit message */
  message: string;
}

/**
 * RAG-sourced incident or interception evidence.
 */
export interface CodeReviewIncidentEvidence {
  /** Query used to retrieve the evidence */
  query: string;
  /** Retrieval status */
  status: string;
  /** Relevant text snippet */
  snippet: string;
  /** Source document or KB entry */
  source: string;
}

/**
 * Code review configuration response DTO.
 */
export interface CodeReviewConfigResponse {
  /** Whether code review is enabled */
  enabled: boolean;
  /** Default operation timeout (millis) */
  defaultTimeout: number;
  /** Git command timeout in seconds */
  commandTimeoutSeconds: number;
  /** Maximum commits to review */
  maxCommits: number;
  /** Maximum files to review */
  maxFiles: number;
  /** Maximum patch characters per file */
  maxPatchCharsPerFile: number;
  /** Score threshold for blocking */
  blockScore: number;
  /** Whether RAG evidence is enabled */
  ragEvidenceEnabled: boolean;
  /** Number of RAG queries per review */
  ragQueriesPerReview: number;
  /** Whether the agent mode is enabled */
  agentEnabled: boolean;
  /** Max files for agent mode */
  agentMaxFiles: number;
  /** Max patch chars per file for agent mode */
  agentMaxPatchCharsPerFile: number;
  /** History file path */
  historyFile: string;
  /** Whether to restrict to allowed root directories */
  requireAllowedRoots: boolean;
  /** Allowed root directories */
  allowedRoots: string[];
}
