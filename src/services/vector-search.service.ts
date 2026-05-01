/**
 * Vector search service - ported from Java VectorSearchService.java
 *
 * Embed query -> Milvus search -> parse results.
 * Returns SearchResult[] with content, score, metadata.
 */

import pino from 'pino';
import type { MilvusClient, SearchSimpleReq, SearchResultData } from '@zilliz/milvus2-sdk-node';
import { MetricType } from '@zilliz/milvus2-sdk-node';
import {
  MILVUS_COLLECTION_NAME,
  FIELD_VECTOR,
  FIELD_ID,
  FIELD_CONTENT,
  FIELD_METADATA,
} from '../constants/milvus.js';
import { generateQueryVector } from './vector-embedding.service.js';
import type { EmbeddingConfig } from '../config/stub.js';

const logger = pino({ name: 'vector-search' });

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: string;
}

/**
 * Search for similar documents in Milvus.
 *
 * @param query         - Query text
 * @param topK          - Number of results to return
 * @param milvusClient  - Milvus client instance
 * @param embeddingCfg  - Embedding configuration
 * @returns Array of search results with content, score, and metadata
 */
export async function searchSimilarDocuments(
  query: string,
  topK: number,
  milvusClient: MilvusClient,
  embeddingCfg: EmbeddingConfig,
): Promise<SearchResult[]> {
  try {
    logger.info({ query, topK }, 'Starting similarity search');

    // 1. Generate query vector
    const queryVector = await generateQueryVector(query, embeddingCfg);
    logger.debug({ dimension: queryVector.length }, 'Query vector generated');

    // 2. Load collection (required for search)
    try {
      await milvusClient.loadCollection({
        collection_name: MILVUS_COLLECTION_NAME,
      });
    } catch {
      // Already loaded
    }

    // 3. Execute search using SearchSimpleReq
    const searchReq: SearchSimpleReq = {
      collection_name: MILVUS_COLLECTION_NAME,
      data: [queryVector],
      limit: topK,
      output_fields: [FIELD_ID, FIELD_CONTENT, FIELD_METADATA],
      anns_field: FIELD_VECTOR,
      metric_type: MetricType.L2,
      params: { nprobe: 10 },
    };

    const searchRes = await milvusClient.search(searchReq);

    // 4. Parse results - search() with SearchSimpleReq returns SearchResultData[]
    const results = parseSearchResults(searchRes.results as SearchResultData[]);
    logger.info({ resultCount: results.length }, 'Search complete');
    return results;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, 'Similarity search failed');
    throw new Error(`Search failed: ${message}`);
  }
}

/**
 * Parse Milvus search results into SearchResult[].
 * SearchResultData has: { [x: string]: any; score: number; id: string; }
 */
function parseSearchResults(data: SearchResultData[]): SearchResult[] {
  const results: SearchResult[] = [];

  if (!data || !Array.isArray(data)) {
    return results;
  }

  for (const item of data) {
    results.push({
      id: String(item.id ?? ''),
      content: String(item[FIELD_CONTENT] ?? ''),
      score: Number(item.score ?? 0),
      metadata: item[FIELD_METADATA]
        ? typeof item[FIELD_METADATA] === 'string'
          ? item[FIELD_METADATA]
          : JSON.stringify(item[FIELD_METADATA])
        : undefined,
    });
  }

  return results;
}
