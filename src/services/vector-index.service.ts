/**
 * Vector index service - ported from Java VectorIndexService.java
 *
 * Orchestrates: read file -> chunk -> embed -> insert to Milvus.
 * Handles delete-then-reinsert for updated files.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import {
  MILVUS_COLLECTION_NAME,
  FIELD_ID,
  FIELD_VECTOR,
  FIELD_CONTENT,
  FIELD_METADATA,
} from '../constants/milvus.js';
import { chunkDocument } from './document-chunk.service.js';
import { generateEmbedding } from './vector-embedding.service.js';
import type { DocumentChunk } from '../types/document-chunk.js';
import type { EmbeddingConfig, DocumentChunkConfig } from '../config/stub.js';

const logger = pino({ name: 'vector-index' });

const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md']);

export interface IndexingResult {
  success: boolean;
  directoryPath?: string;
  totalFiles: number;
  successCount: number;
  failCount: number;
  startTime: Date;
  endTime?: Date;
  errorMessage?: string;
  failedFiles: Record<string, string>;
}

/**
 * Index all supported files in a directory.
 */
export async function indexDirectory(
  directoryPath: string,
  milvusClient: MilvusClient,
  embeddingCfg: EmbeddingConfig,
  chunkCfg: DocumentChunkConfig,
): Promise<IndexingResult> {
  const result: IndexingResult = {
    success: false,
    totalFiles: 0,
    successCount: 0,
    failCount: 0,
    startTime: new Date(),
    failedFiles: {},
  };

  try {
    const dirStat = await stat(directoryPath);
    if (!dirStat.isDirectory()) {
      throw new Error(`Path is not a directory: ${directoryPath}`);
    }

    result.directoryPath = directoryPath;

    const entries = await readdir(directoryPath);
    const files = entries.filter((name) => SUPPORTED_EXTENSIONS.has(extname(name)));

    if (files.length === 0) {
      logger.warn({ directoryPath }, 'No supported files found in directory');
      result.totalFiles = 0;
      result.success = true;
      result.endTime = new Date();
      return result;
    }

    result.totalFiles = files.length;
    logger.info({ directoryPath, fileCount: files.length }, 'Starting directory indexing');

    for (const file of files) {
      const filePath = join(directoryPath, file);
      try {
        await indexSingleFile(filePath, milvusClient, embeddingCfg, chunkCfg);
        result.successCount++;
        logger.info({ file }, 'File indexed successfully');
      } catch (err) {
        result.failCount++;
        const message = err instanceof Error ? err.message : String(err);
        result.failedFiles[filePath] = message;
        logger.error({ file, error: message }, 'File indexing failed');
      }
    }

    result.success = result.failCount === 0;
    result.endTime = new Date();

    logger.info(
      {
        totalFiles: result.totalFiles,
        success: result.successCount,
        failed: result.failCount,
      },
      'Directory indexing complete',
    );

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message }, 'Directory indexing failed');
    result.success = false;
    result.errorMessage = message;
    result.endTime = new Date();
    return result;
  }
}

/**
 * Index a single file: read -> chunk -> embed -> insert to Milvus.
 */
export async function indexSingleFile(
  filePath: string,
  milvusClient: MilvusClient,
  embeddingCfg: EmbeddingConfig,
  chunkCfg: DocumentChunkConfig,
): Promise<void> {
  const normalizedPath = normalize(filePath);

  logger.info({ filePath: normalizedPath }, 'Starting file indexing');

  // 1. Read file content
  const content = await readFile(normalizedPath, 'utf-8');
  logger.info({ filePath: normalizedPath, contentLength: content.length }, 'File read');

  // 2. Delete old data for this file
  await deleteExistingData(normalizedPath, milvusClient);

  // 3. Chunk the document
  const chunks = chunkDocument(content, normalizedPath, chunkCfg);
  logger.info({ filePath: normalizedPath, chunkCount: chunks.length }, 'Document chunked');

  // 4. Generate embeddings and insert to Milvus
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const vector = await generateEmbedding(chunk.content, embeddingCfg);
      const metadata = buildMetadata(normalizedPath, chunk, chunks.length);
      await insertToMilvus(chunk.content, vector, metadata, chunk.chunkIndex, milvusClient);
      logger.debug({ chunk: i + 1, total: chunks.length }, 'Chunk indexed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ chunk: i + 1, total: chunks.length, error: message }, 'Chunk indexing failed');
      throw new Error(`Chunk indexing failed: ${message}`);
    }
  }

  logger.info({ filePath: normalizedPath, chunkCount: chunks.length }, 'File indexing complete');
}

/**
 * Delete existing data for a file (by metadata._source).
 */
async function deleteExistingData(
  filePath: string,
  milvusClient: MilvusClient,
): Promise<void> {
  try {
    // Normalize path separators to forward slash for consistent storage
    const normalizedPath = filePath.replace(/\\/g, '/');
    const expr = `metadata["_source"] == "${normalizedPath}"`;

    logger.info({ filePath: normalizedPath, expr }, 'Deleting old data');

    // Load collection first (required for delete)
    try {
      await milvusClient.loadCollection({
        collection_name: MILVUS_COLLECTION_NAME,
      });
    } catch {
      // Collection may already be loaded; ignore
    }

    const res = await milvusClient.delete({
      collection_name: MILVUS_COLLECTION_NAME,
      filter: expr,
    });

    if (res.status.error_code !== 'Success' && res.status.error_code !== 0) {
      logger.warn({ error: res.status.reason }, 'Delete old data returned warning');
    } else {
      logger.info(
        { filePath: normalizedPath, deleteCnt: res.delete_cnt },
        'Old data deleted',
      );
    }
  } catch (err) {
    // May fail on first index (no data yet); log and continue
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Delete old data failed (possibly first index)');
  }
}

/**
 * Build metadata object for a chunk.
 */
function buildMetadata(
  filePath: string,
  chunk: DocumentChunk,
  totalChunks: number,
): Record<string, unknown> {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = filePath.split(sep).pop() ?? '';
  const ext = extname(fileName);

  const metadata: Record<string, unknown> = {
    _source: normalizedPath,
    _extension: ext,
    _file_name: fileName,
    chunkIndex: chunk.chunkIndex,
    totalChunks,
  };

  if (chunk.title) {
    metadata.title = chunk.title;
  }

  return metadata;
}

/**
 * Insert a single vector record into Milvus.
 */
async function insertToMilvus(
  content: string,
  vector: number[],
  metadata: Record<string, unknown>,
  chunkIndex: number,
  milvusClient: MilvusClient,
): Promise<void> {
  // Ensure collection is loaded
  try {
    await milvusClient.loadCollection({
      collection_name: MILVUS_COLLECTION_NAME,
    });
  } catch {
    // Already loaded
  }

  // Generate deterministic ID from source path + chunk index
  const source = metadata._source as string;
  const id = `${source}_${chunkIndex}`;

  const res = await milvusClient.insert({
    collection_name: MILVUS_COLLECTION_NAME,
    data: [
      {
        [FIELD_ID]: id,
        [FIELD_CONTENT]: content,
        [FIELD_VECTOR]: vector,
        [FIELD_METADATA]: metadata,
      },
    ],
  });

  if (res.status.error_code !== 'Success' && res.status.error_code !== 0) {
    throw new Error(`Insert failed: ${res.status.reason}`);
  }

  logger.debug({ id, source, chunkIndex }, 'Vector inserted');
}
