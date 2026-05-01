import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function env(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value !== undefined) return value;
  if (fallback !== undefined) return fallback;
  return '';
}

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function envArray(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Resolve API keys from provider-specific env vars
// ---------------------------------------------------------------------------

function resolveLlmApiKey(provider: string): string {
  switch (provider) {
    case 'openai':
      return env('OPENAI_API_KEY', env('LLM_API_KEY'));
    case 'anthropic':
      return env('ANTHROPIC_API_KEY', env('LLM_API_KEY'));
    case 'dashscope':
      return env('DASHSCOPE_API_KEY', env('LLM_API_KEY'));
    default:
      return env('LLM_API_KEY');
  }
}

function resolveEmbeddingApiKey(provider: string): string {
  switch (provider) {
    case 'openai':
      return env('OPENAI_API_KEY', env('EMBEDDING_API_KEY'));
    case 'dashscope':
      return env('DASHSCOPE_API_KEY', env('EMBEDDING_API_KEY'));
    default:
      return env('EMBEDDING_API_KEY');
  }
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const LlmProviderEnum = z.enum(['openai', 'anthropic', 'dashscope']);
const EmbeddingProviderEnum = z.enum(['openai', 'dashscope']);

const serverSchema = z.object({
  port: z.number(),
});

const llmSchema = z.object({
  provider: LlmProviderEnum,
  model: z.string().min(1, 'LLM_MODEL is required'),
  apiKey: z.string().min(1, 'LLM API key is required'),
});

const embeddingSchema = z.object({
  provider: EmbeddingProviderEnum,
  model: z.string().min(1, 'EMBEDDING_MODEL is required'),
  apiKey: z.string().min(1, 'Embedding API key is required'),
});

const milvusSchema = z.object({
  host: z.string(),
  port: z.number(),
  username: z.string(),
  password: z.string(),
  database: z.string(),
  timeout: z.number(),
});

const ragSchema = z.object({
  topK: z.number(),
  model: z.string(),
});

const prometheusSchema = z.object({
  baseUrl: z.string().url(),
  timeout: z.number(),
  mockEnabled: z.boolean(),
});

const clsSchema = z.object({
  mockEnabled: z.boolean(),
});

const guardSchema = z.object({
  enabled: z.boolean(),
  failureThreshold: z.number(),
  toolCallLimit: z.number(),
  modelCallLimit: z.number(),
  limitMessage: z.string(),
});

const agentSchema = z.object({
  guard: guardSchema,
});

const scoreWeightsSchema = z.object({
  production: z.number(),
  peakWindow: z.number(),
  emergency: z.number(),
  databaseChange: z.number(),
  configChange: z.number(),
  largeChange: z.number(),
  activeAlerts: z.number(),
  missingRunbook: z.number(),
  recentIncident: z.number(),
  missingDeploymentHistory: z.number(),
});

const requiredEvidenceSchema = z.object({
  deploymentHistory: z.boolean(),
  serviceBaseline: z.boolean(),
  rollbackRunbook: z.boolean(),
});

const releasePrecheckSchema = z.object({
  enabled: z.boolean(),
  defaultTimeout: z.number(),
  historyFile: z.string(),
  weightAuditFile: z.string(),
  scoreWeights: scoreWeightsSchema,
  requiredEvidence: requiredEvidenceSchema,
});

const releaseSchema = z.object({
  precheck: releasePrecheckSchema,
});

const codeReviewSchema = z.object({
  enabled: z.boolean(),
  defaultTimeout: z.number(),
  commandTimeoutSeconds: z.number(),
  historyFile: z.string(),
  maxCommits: z.number(),
  maxFiles: z.number(),
  maxPatchCharsPerFile: z.number(),
  blockScore: z.number(),
  ragEvidenceEnabled: z.boolean(),
  ragQueriesPerReview: z.number(),
  agentEnabled: z.boolean(),
  agentMaxFiles: z.number(),
  agentMaxPatchCharsPerFile: z.number(),
  requireAllowedRoots: z.boolean(),
  allowedRoots: z.array(z.string()),
});

const codeSchema = z.object({
  review: codeReviewSchema,
});

const documentChunkSchema = z.object({
  maxSize: z.number(),
  overlap: z.number(),
});

const documentSchema = z.object({
  chunk: documentChunkSchema,
});

const fileUploadSchema = z.object({
  path: z.string(),
  allowedExtensions: z.array(z.string()),
});

const fileSchema = z.object({
  upload: fileUploadSchema,
});

// ---------------------------------------------------------------------------
// Root config schema
// ---------------------------------------------------------------------------

const configSchema = z.object({
  server: serverSchema,
  llm: llmSchema,
  embedding: embeddingSchema,
  milvus: milvusSchema,
  rag: ragSchema,
  prometheus: prometheusSchema,
  cls: clsSchema,
  agent: agentSchema,
  release: releaseSchema,
  code: codeSchema,
  document: documentSchema,
  file: fileSchema,
});

// ---------------------------------------------------------------------------
// Config type (inferred from Zod)
// ---------------------------------------------------------------------------

export type AppConfig = z.infer<typeof configSchema>;

export type LlmProvider = z.infer<typeof LlmProviderEnum>;
export type EmbeddingProvider = z.infer<typeof EmbeddingProviderEnum>;

// ---------------------------------------------------------------------------
// Build config from environment variables
// ---------------------------------------------------------------------------

function buildConfig(): AppConfig {
  const llmProvider = env('LLM_PROVIDER', 'openai') as LlmProvider;
  const embeddingProvider = env('EMBEDDING_PROVIDER', 'openai') as EmbeddingProvider;

  return {
    server: {
      port: envNumber('PORT', 9900),
    },
    llm: {
      provider: llmProvider,
      model: env('LLM_MODEL', 'gpt-4o'),
      apiKey: resolveLlmApiKey(llmProvider),
    },
    embedding: {
      provider: embeddingProvider,
      model: env('EMBEDDING_MODEL', 'text-embedding-3-small'),
      apiKey: resolveEmbeddingApiKey(embeddingProvider),
    },
    milvus: {
      host: env('MILVUS_HOST', 'localhost'),
      port: envNumber('MILVUS_PORT', 19530),
      username: env('MILVUS_USERNAME', ''),
      password: env('MILVUS_PASSWORD', ''),
      database: env('MILVUS_DATABASE', 'default'),
      timeout: envNumber('MILVUS_TIMEOUT', 10000),
    },
    rag: {
      topK: envNumber('RAG_TOP_K', 3),
      model: env('RAG_MODEL', 'gpt-4o'),
    },
    prometheus: {
      baseUrl: env('PROMETHEUS_BASE_URL', 'http://localhost:9090'),
      timeout: envNumber('PROMETHEUS_TIMEOUT', 10),
      mockEnabled: envBool('PROMETHEUS_MOCK_ENABLED', false),
    },
    cls: {
      mockEnabled: envBool('CLS_MOCK_ENABLED', false),
    },
    agent: {
      guard: {
        enabled: envBool('AGENT_GUARD_ENABLED', true),
        failureThreshold: envNumber('AGENT_FAILURE_THRESHOLD', 3),
        toolCallLimit: envNumber('AGENT_TOOL_CALL_LIMIT', 12),
        modelCallLimit: envNumber('AGENT_MODEL_CALL_LIMIT', 25),
        limitMessage: env(
          'AGENT_LIMIT_MESSAGE',
          '达到重试上限，工具无法调用，请停止继续调用该工具并基于已有证据给出结论。',
        ),
      },
    },
    release: {
      precheck: {
        enabled: envBool('RELEASE_PRECHECK_ENABLED', true),
        defaultTimeout: envNumber('RELEASE_PRECHECK_DEFAULT_TIMEOUT', 900000),
        historyFile: env('RELEASE_PRECHECK_HISTORY_FILE', './uploads/release-precheck-history.json'),
        weightAuditFile: env('RELEASE_PRECHECK_WEIGHT_AUDIT_FILE', './uploads/release-precheck-weight-audit.json'),
        scoreWeights: {
          production: envNumber('SCORE_WEIGHT_PRODUCTION', 15),
          peakWindow: envNumber('SCORE_WEIGHT_PEAK_WINDOW', 10),
          emergency: envNumber('SCORE_WEIGHT_EMERGENCY', 20),
          databaseChange: envNumber('SCORE_WEIGHT_DATABASE_CHANGE', 15),
          configChange: envNumber('SCORE_WEIGHT_CONFIG_CHANGE', 8),
          largeChange: envNumber('SCORE_WEIGHT_LARGE_CHANGE', 12),
          activeAlerts: envNumber('SCORE_WEIGHT_ACTIVE_ALERTS', 20),
          missingRunbook: envNumber('SCORE_WEIGHT_MISSING_RUNBOOK', 15),
          recentIncident: envNumber('SCORE_WEIGHT_RECENT_INCIDENT', 10),
          missingDeploymentHistory: envNumber('SCORE_WEIGHT_MISSING_DEPLOYMENT_HISTORY', 8),
        },
        requiredEvidence: {
          deploymentHistory: envBool('REQUIRED_EVIDENCE_DEPLOYMENT_HISTORY', true),
          serviceBaseline: envBool('REQUIRED_EVIDENCE_SERVICE_BASELINE', true),
          rollbackRunbook: envBool('REQUIRED_EVIDENCE_ROLLBACK_RUNBOOK', true),
        },
      },
    },
    code: {
      review: {
        enabled: envBool('CODE_REVIEW_ENABLED', true),
        defaultTimeout: envNumber('CODE_REVIEW_DEFAULT_TIMEOUT', 900000),
        commandTimeoutSeconds: envNumber('CODE_REVIEW_COMMAND_TIMEOUT_SECONDS', 20),
        historyFile: env('CODE_REVIEW_HISTORY_FILE', './uploads/code-review-history.json'),
        maxCommits: envNumber('CODE_REVIEW_MAX_COMMITS', 30),
        maxFiles: envNumber('CODE_REVIEW_MAX_FILES', 200),
        maxPatchCharsPerFile: envNumber('CODE_REVIEW_MAX_PATCH_CHARS_PER_FILE', 12000),
        blockScore: envNumber('CODE_REVIEW_BLOCK_SCORE', 65),
        ragEvidenceEnabled: envBool('CODE_REVIEW_RAG_EVIDENCE_ENABLED', true),
        ragQueriesPerReview: envNumber('CODE_REVIEW_RAG_QUERIES_PER_REVIEW', 3),
        agentEnabled: envBool('CODE_REVIEW_AGENT_ENABLED', true),
        agentMaxFiles: envNumber('CODE_REVIEW_AGENT_MAX_FILES', 8),
        agentMaxPatchCharsPerFile: envNumber('CODE_REVIEW_AGENT_MAX_PATCH_CHARS_PER_FILE', 4000),
        requireAllowedRoots: envBool('CODE_REVIEW_REQUIRE_ALLOWED_ROOTS', false),
        allowedRoots: envArray('CODE_REVIEW_ALLOWED_ROOTS', ['.']),
      },
    },
    document: {
      chunk: {
        maxSize: envNumber('DOCUMENT_CHUNK_MAX_SIZE', 800),
        overlap: envNumber('DOCUMENT_CHUNK_OVERLAP', 100),
      },
    },
    file: {
      upload: {
        path: env('FILE_UPLOAD_PATH', './uploads'),
        allowedExtensions: envArray('FILE_UPLOAD_ALLOWED_EXTENSIONS', ['txt', 'md']),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton config — validated once at import time
// ---------------------------------------------------------------------------

let _config: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (_config === undefined) {
    const raw = buildConfig();
    const result = configSchema.safeParse(raw);
    if (!result.success) {
      const formatted = result.error.format();
      throw new Error(
        `Invalid application configuration:\n${JSON.stringify(formatted, null, 2)}`,
      );
    }
    _config = result.data;
  }
  return _config;
}

/** Reset cached config (for testing). */
export function resetConfig(): void {
  _config = undefined;
}

export { configSchema };
