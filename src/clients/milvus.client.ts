/**
 * Milvus client factory - ported from Java MilvusClientFactory.java + MilvusConfig.java
 *
 * Uses @zilliz/milvus2-sdk-node to create a Milvus client.
 * Handles connection, collection creation, index creation, and health check.
 */

import { MilvusClient, DataType, IndexType, MetricType } from '@zilliz/milvus2-sdk-node';
import type { ResStatus } from '@zilliz/milvus2-sdk-node';
import pino from 'pino';
import {
  MILVUS_COLLECTION_NAME,
  VECTOR_DIM,
  ID_MAX_LENGTH,
  CONTENT_MAX_LENGTH,
  DEFAULT_SHARD_NUMBER,
  FIELD_ID,
  FIELD_VECTOR,
  FIELD_CONTENT,
  FIELD_METADATA,
} from '../constants/milvus.js';
import type { MilvusConfig } from '../config/stub.js';

const logger = pino({ name: 'milvus-client' });

/** Singleton Milvus client instance */
let clientInstance: MilvusClient | null = null;

/**
 * Check that a Milvus response succeeded.
 * The SDK returns { status: { error_code, reason, ... } }.
 */
function assertOk(res: ResStatus, message: string): void {
  if (res.error_code !== 'Success' && res.error_code !== 0) {
    throw new Error(`${message}: ${res.reason ?? res.detail ?? JSON.stringify(res)}`);
  }
}

/**
 * Create and initialize a Milvus client.
 * - Connects to Milvus
 * - Ensures the "biz" collection exists (creates it if missing)
 * - Creates IVF_FLAT index on the vector field
 */
export async function createMilvusClient(cfg: MilvusConfig): Promise<MilvusClient> {
  logger.info({ host: cfg.host, port: cfg.port }, 'Connecting to Milvus');

  const client = new MilvusClient({
    address: `${cfg.host}:${cfg.port}`,
    username: cfg.username || undefined,
    password: cfg.password || undefined,
    timeout: cfg.timeout,
  });

  // Check health
  const health = await client.checkHealth();
  if (!health.isHealthy) {
    throw new Error('Milvus health check failed');
  }
  logger.info('Connected to Milvus successfully');

  // Ensure collection exists
  const hasCol = await client.hasCollection({ collection_name: MILVUS_COLLECTION_NAME });
  if (!hasCol.value) {
    logger.info({ collection: MILVUS_COLLECTION_NAME }, 'Collection does not exist, creating...');
    await createBizCollection(client);
    await createVectorIndex(client);
    logger.info('Collection and index created successfully');
  } else {
    logger.info({ collection: MILVUS_COLLECTION_NAME }, 'Collection already exists');
  }

  return client;
}

/**
 * Create the "biz" collection with the expected schema.
 */
async function createBizCollection(client: MilvusClient): Promise<void> {
  const res = await client.createCollection({
    collection_name: MILVUS_COLLECTION_NAME,
    description: 'Business knowledge collection',
    shards_num: DEFAULT_SHARD_NUMBER,
    enable_dynamic_field: false,
    fields: [
      {
        name: FIELD_ID,
        data_type: DataType.VarChar,
        max_length: ID_MAX_LENGTH,
        is_primary_key: true,
      },
      {
        name: FIELD_VECTOR,
        data_type: DataType.FloatVector,
        dim: VECTOR_DIM,
      },
      {
        name: FIELD_CONTENT,
        data_type: DataType.VarChar,
        max_length: CONTENT_MAX_LENGTH,
      },
      {
        name: FIELD_METADATA,
        data_type: DataType.JSON,
      },
    ],
  });
  assertOk(res, 'Failed to create collection');
}

/**
 * Create IVF_FLAT index on the vector field.
 */
async function createVectorIndex(client: MilvusClient): Promise<void> {
  const res = await client.createIndex({
    collection_name: MILVUS_COLLECTION_NAME,
    field_name: FIELD_VECTOR,
    extra_params: {
      index_type: IndexType.IVF_FLAT,
      metric_type: MetricType.L2,
      params: JSON.stringify({ nlist: 128 }),
    },
  });
  assertOk(res, 'Failed to create vector index');
}

/**
 * Get or create the singleton Milvus client.
 */
export async function getMilvusClient(cfg: MilvusConfig): Promise<MilvusClient> {
  if (!clientInstance) {
    clientInstance = await createMilvusClient(cfg);
  }
  return clientInstance;
}

/**
 * Close the singleton client (for graceful shutdown).
 */
export async function closeMilvusClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.closeConnection();
    clientInstance = null;
    logger.info('Milvus client connection closed');
  }
}
