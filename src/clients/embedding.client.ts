/**
 * Multi-provider embedding client - ported from Java VectorEmbeddingService.java
 *
 * Supports:
 * - OpenAI embedding API (via fetch to /v1/embeddings)
 * - DashScope embedding API (POST to https://dashscope.aliyuncs.com/api/v1/embeddings)
 *
 * The provider choice comes from config.
 */

import pino from 'pino';
import type { EmbeddingConfig } from '../config/stub.js';

const logger = pino({ name: 'embedding-client' });

/** DashScope embedding API response shape */
interface DashScopeEmbeddingResponse {
  output?: {
    embeddings?: Array<{ text_index: number; embedding: number[] }>;
  };
  usage?: { total_tokens: number };
  request_id?: string;
}

/** OpenAI embedding API response shape */
interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding: number[]; index: number }>;
  usage?: { total_tokens: number };
}

/**
 * Generate embeddings for one or more texts using the configured provider.
 *
 * @param texts - Array of text strings to embed
 * @param cfg  - Embedding configuration (provider, model, apiKey, baseUrl)
 * @returns Array of embedding vectors (number[][])
 */
export async function generateEmbeddings(
  texts: string[],
  cfg: EmbeddingConfig,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  if (cfg.provider === 'dashscope') {
    return callDashScopeEmbedding(texts, cfg);
  }

  return callOpenAIEmbedding(texts, cfg);
}

/**
 * Generate a single embedding vector for a query string.
 */
export async function generateQueryEmbedding(
  text: string,
  cfg: EmbeddingConfig,
): Promise<number[]> {
  const results = await generateEmbeddings([text], cfg);
  if (results.length === 0) {
    throw new Error('Embedding API returned empty result');
  }
  return results[0];
}

/**
 * Call DashScope embedding API.
 * POST https://dashscope.aliyuncs.com/api/v1/embeddings
 */
async function callDashScopeEmbedding(
  texts: string[],
  cfg: EmbeddingConfig,
): Promise<number[][]> {
  const baseUrl = cfg.baseUrl ?? 'https://dashscope.aliyuncs.com/api/v1';
  const url = `${baseUrl}/embeddings`;

  const body = {
    model: cfg.model,
    input: { texts },
  };

  logger.debug({ textCount: texts.length, model: cfg.model }, 'Calling DashScope embedding API');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`DashScope embedding API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as DashScopeEmbeddingResponse;

  if (!data.output?.embeddings || data.output.embeddings.length === 0) {
    throw new Error('DashScope embedding API returned empty embeddings');
  }

  // Sort by text_index to ensure correct ordering
  const sorted = [...data.output.embeddings].sort((a, b) => a.text_index - b.text_index);
  return sorted.map((item) => item.embedding);
}

/**
 * Call OpenAI-compatible embedding API.
 * POST {baseUrl}/embeddings  (or https://api.openai.com/v1/embeddings)
 */
async function callOpenAIEmbedding(
  texts: string[],
  cfg: EmbeddingConfig,
): Promise<number[][]> {
  const baseUrl = cfg.baseUrl ?? 'https://api.openai.com/v1';
  const url = `${baseUrl}/embeddings`;

  const body = {
    model: cfg.model,
    input: texts,
  };

  logger.debug({ textCount: texts.length, model: cfg.model }, 'Calling OpenAI embedding API');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI embedding API error (${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as OpenAIEmbeddingResponse;

  if (!data.data || data.data.length === 0) {
    throw new Error('OpenAI embedding API returned empty data');
  }

  // Sort by index to ensure correct ordering
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  return sorted.map((item) => item.embedding);
}
