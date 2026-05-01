/**
 * Vector embedding service - ported from Java VectorEmbeddingService.java
 *
 * Wrapper service that uses the embedding client to generate embeddings
 * for document chunks and queries.
 */

import pino from 'pino';
import { generateEmbeddings, generateQueryEmbedding } from '../clients/embedding.client.js';
import type { EmbeddingConfig } from '../config/stub.js';

const logger = pino({ name: 'vector-embedding' });

/**
 * Generate a single embedding for content.
 */
export async function generateEmbedding(
  content: string,
  cfg: EmbeddingConfig,
): Promise<number[]> {
  if (!content || content.trim().length === 0) {
    throw new Error('Content cannot be empty');
  }

  logger.debug({ contentLength: content.length }, 'Generating embedding');
  const vectors = await generateEmbeddings([content], cfg);

  if (vectors.length === 0) {
    throw new Error('Embedding API returned empty result');
  }

  logger.info(
    { contentLength: content.length, dimension: vectors[0].length },
    'Embedding generated successfully',
  );
  return vectors[0];
}

/**
 * Generate embeddings for multiple contents (batch).
 */
export async function generateEmbeddingBatch(
  contents: string[],
  cfg: EmbeddingConfig,
): Promise<number[][]> {
  if (contents.length === 0) {
    return [];
  }

  logger.info({ count: contents.length }, 'Generating batch embeddings');
  const vectors = await generateEmbeddings(contents, cfg);

  logger.info(
    { count: vectors.length, dimension: vectors.length > 0 ? vectors[0].length : 0 },
    'Batch embeddings generated successfully',
  );
  return vectors;
}

/**
 * Generate a query embedding (alias for single embedding).
 */
export async function generateQueryVector(
  query: string,
  cfg: EmbeddingConfig,
): Promise<number[]> {
  logger.debug({ queryLength: query.length }, 'Generating query vector');
  return generateQueryEmbedding(query, cfg);
}
