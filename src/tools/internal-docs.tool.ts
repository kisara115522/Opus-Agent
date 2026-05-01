/**
 * Internal docs tool - ported from Java InternalDocsTools.java
 *
 * Uses RAG (Retrieval-Augmented Generation) to search internal knowledge base
 * via VectorSearchService. Returns JSON with search results including
 * content, similarity scores, and metadata.
 */

import { tool } from 'ai';
import { z } from 'zod';
import pino from 'pino';
import type { SearchResult } from '../services/vector-search.service.js';
import { searchSimilarDocuments } from '../services/vector-search.service.js';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { EmbeddingConfig } from '../config/stub.js';

const logger = pino({ name: 'internal-docs-tool' });

/** No-results response matching Java format */
const NO_RESULTS_RESPONSE = {
  status: 'no_results',
  message: 'No relevant documents found in the knowledge base.',
};

/**
 * Dependencies required by the internal docs tool.
 */
export interface InternalDocsToolDeps {
  milvusClient: MilvusClient;
  embeddingConfig: EmbeddingConfig;
  topK?: number;
}

/**
 * Creates the queryInternalDocs tool.
 * Performs RAG search against the vector database.
 *
 * @param deps - Dependencies: milvusClient, embeddingConfig, optional topK
 */
export function createInternalDocsTool(deps: InternalDocsToolDeps) {
  const { milvusClient, embeddingConfig, topK = 3 } = deps;

  return tool({
    description:
      'Use this tool to search internal documentation and knowledge base for relevant information. ' +
      'It performs RAG (Retrieval-Augmented Generation) to find similar documents and extract processing steps. ' +
      'This is useful when you need to understand internal procedures, best practices, or step-by-step guides ' +
      'stored in the company\'s documentation.',
    parameters: z.object({
      query: z.string().describe('Search query describing what information you are looking for'),
    }),
    execute: async ({ query }) => {
      logger.info({ query, topK }, 'Executing queryInternalDocs tool');

      try {
        const results: SearchResult[] = await searchSimilarDocuments(
          query,
          topK,
          milvusClient,
          embeddingConfig,
        );

        if (results.length === 0) {
          logger.info('No relevant documents found');
          return NO_RESULTS_RESPONSE;
        }

        logger.info({ resultCount: results.length }, 'Internal docs search complete');
        return results;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'queryInternalDocs execution failed');
        return {
          status: 'error',
          message: `Failed to query internal docs: ${message}`,
        };
      }
    },
  });
}
