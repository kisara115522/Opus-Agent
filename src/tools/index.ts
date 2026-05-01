/**
 * Tools barrel export.
 *
 * Exports individual tool factories and a convenience `createAllTools` function
 * that wires up all tools with their dependencies.
 */

import type { Tool } from 'ai';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { AppConfig } from '../config/index.js';
import type { EmbeddingConfig } from '../config/stub.js';
import { createDateTimeTool } from './datetime.tool.js';
import { createInternalDocsTool } from './internal-docs.tool.js';
import { createQueryMetricsTool } from './query-metrics.tool.js';
import { createGetAvailableLogTopicsTool, createQueryLogsTool } from './query-logs.tool.js';

// Re-export individual factories
export { createDateTimeTool } from './datetime.tool.js';
export { createInternalDocsTool, type InternalDocsToolDeps } from './internal-docs.tool.js';
export { createQueryMetricsTool } from './query-metrics.tool.js';
export { createGetAvailableLogTopicsTool, createQueryLogsTool } from './query-logs.tool.js';

// ---------------------------------------------------------------------------
// Dependencies for createAllTools
// ---------------------------------------------------------------------------

export interface AllToolsDeps {
  /** Milvus client for vector search */
  milvusClient: MilvusClient;
  /** Embedding configuration for vector generation */
  embeddingConfig: EmbeddingConfig;
  /** Application configuration */
  config: AppConfig;
  /** Number of results for RAG search (default: from config.rag.topK) */
  ragTopK?: number;
}

// ---------------------------------------------------------------------------
// Tool name constants (matching Java TOOL_* constants)
// ---------------------------------------------------------------------------

export const TOOL_GET_CURRENT_DATETIME = 'getCurrentDateTime';
export const TOOL_QUERY_INTERNAL_DOCS = 'queryInternalDocs';
export const TOOL_QUERY_PROMETHEUS_ALERTS = 'queryPrometheusAlerts';
export const TOOL_QUERY_LOGS = 'queryLogs';
export const TOOL_GET_AVAILABLE_LOG_TOPICS = 'getAvailableLogTopics';

// ---------------------------------------------------------------------------
// createAllTools
// ---------------------------------------------------------------------------

/**
 * Create all agent tools with their dependencies wired.
 *
 * Returns a `Record<string, Tool>` suitable for passing to `createReactAgent`.
 *
 * @param deps - Dependencies: milvusClient, embeddingConfig, config, optional ragTopK
 */
export function createAllTools(deps: AllToolsDeps): Record<string, Tool> {
  const { milvusClient, embeddingConfig, config, ragTopK } = deps;

  return {
    [TOOL_GET_CURRENT_DATETIME]: createDateTimeTool(),
    [TOOL_QUERY_INTERNAL_DOCS]: createInternalDocsTool({
      milvusClient,
      embeddingConfig,
      topK: ragTopK ?? config.rag.topK,
    }),
    [TOOL_QUERY_PROMETHEUS_ALERTS]: createQueryMetricsTool(config),
    [TOOL_GET_AVAILABLE_LOG_TOPICS]: createGetAvailableLogTopicsTool(),
    [TOOL_QUERY_LOGS]: createQueryLogsTool(config),
  };
}
