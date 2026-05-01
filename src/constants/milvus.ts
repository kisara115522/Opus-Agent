/**
 * Milvus constants - ported from Java MilvusConstants.java
 */

/** Milvus database name */
export const MILVUS_DB_NAME = 'default';

/** Milvus collection name */
export const MILVUS_COLLECTION_NAME = 'biz';

/** Vector dimension (matching the embedding model's output dimension) */
export const VECTOR_DIM = 1024;

/** ID field max length */
export const ID_MAX_LENGTH = 256;

/** Content field max length */
export const CONTENT_MAX_LENGTH = 8192;

/** Default shard count */
export const DEFAULT_SHARD_NUMBER = 2;

/** Field names in the Milvus collection */
export const FIELD_ID = 'id';
export const FIELD_VECTOR = 'vector';
export const FIELD_CONTENT = 'content';
export const FIELD_METADATA = 'metadata';
