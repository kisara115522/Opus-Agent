/**
 * Stub config with hardcoded defaults.
 * Replace with a proper Zod-validated config module when ready.
 */

export interface MilvusConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  timeout: number;
}

export interface EmbeddingConfig {
  provider: 'openai' | 'dashscope';
  model: string;
  apiKey: string;
  /** DashScope base URL, only used when provider is 'dashscope' */
  baseUrl?: string;
}

export interface DocumentChunkConfig {
  maxSize: number;
  overlap: number;
}

export interface RAGConfig {
  topK: number;
  model: string;
}

export interface AppConfig {
  milvus: MilvusConfig;
  embedding: EmbeddingConfig;
  documentChunk: DocumentChunkConfig;
  rag: RAGConfig;
  uploadPath: string;
}

export const config: AppConfig = {
  milvus: {
    host: process.env.MILVUS_HOST ?? 'localhost',
    port: Number(process.env.MILVUS_PORT ?? '19530'),
    username: process.env.MILVUS_USERNAME ?? '',
    password: process.env.MILVUS_PASSWORD ?? '',
    database: process.env.MILVUS_DATABASE ?? 'default',
    timeout: 10_000,
  },
  embedding: {
    provider: (process.env.EMBEDDING_PROVIDER as 'openai' | 'dashscope') ?? 'openai',
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    apiKey: process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    baseUrl: process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/api/v1',
  },
  documentChunk: {
    maxSize: 800,
    overlap: 100,
  },
  rag: {
    topK: Number(process.env.RAG_TOP_K ?? '3'),
    model: process.env.RAG_MODEL ?? 'gpt-4o',
  },
  uploadPath: process.env.FILE_UPLOAD_PATH ?? './uploads',
};
