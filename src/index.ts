/**
 * Application Entry Point
 *
 * Bootstraps and starts the Hono HTTP server:
 * 1. Load environment variables (dotenv)
 * 2. Initialize application config (Zod-validated)
 * 3. Create provider registry (LLM + Embedding providers)
 * 4. Initialize Milvus client
 * 5. Create agent tools
 * 6. Create and start Hono server
 * 7. Register graceful shutdown handlers
 */

import 'dotenv/config';
import { serve } from '@hono/node-server';
import pino from 'pino';
import { getConfig } from './config/index.js';
import { createProviderRegistry } from './providers/index.js';
import { getMilvusClient, closeMilvusClient } from './clients/milvus.client.js';
import { createAllTools } from './tools/index.js';
import { createApp } from './server/index.js';

const logger = pino({ name: 'main' });

async function main(): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Load and validate configuration
  // -------------------------------------------------------------------------
  logger.info('Loading application configuration...');
  const config = getConfig();
  logger.info({ port: config.server.port, llmProvider: config.llm.provider }, 'Configuration loaded');

  // -------------------------------------------------------------------------
  // 2. Create provider registry
  // -------------------------------------------------------------------------
  logger.info('Initializing provider registry...');
  const providerRegistry = createProviderRegistry(config);
  logger.info(
    { llmProviders: providerRegistry.listLLM(), embeddingProviders: providerRegistry.listEmbedding() },
    'Provider registry initialized',
  );

  // -------------------------------------------------------------------------
  // 3. Initialize Milvus client
  // -------------------------------------------------------------------------
  logger.info('Connecting to Milvus...');
  const milvusClient = await getMilvusClient({
    host: config.milvus.host,
    port: config.milvus.port,
    username: config.milvus.username,
    password: config.milvus.password,
    database: config.milvus.database,
    timeout: config.milvus.timeout,
  });
  logger.info('Milvus client initialized');

  // -------------------------------------------------------------------------
  // 4. Create agent tools
  // -------------------------------------------------------------------------
  logger.info('Creating agent tools...');
  const tools = createAllTools({
    milvusClient,
    embeddingConfig: {
      provider: config.embedding.provider,
      model: config.embedding.model,
      apiKey: config.embedding.apiKey,
    },
    config,
  });
  logger.info({ toolCount: Object.keys(tools).length }, 'Agent tools created');

  // -------------------------------------------------------------------------
  // 5. Create and start Hono server
  // -------------------------------------------------------------------------
  logger.info('Creating Hono application...');
  const app = createApp({
    config,
    providerRegistry,
    milvusClient,
    tools,
  });

  const port = config.server.port;
  logger.info({ port }, 'Starting HTTP server...');

  serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      logger.info({ port: info.port }, `Server running at http://localhost:${info.port}`);
    },
  );

  // -------------------------------------------------------------------------
  // 6. Graceful shutdown
  // -------------------------------------------------------------------------
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, closing resources...');
    await closeMilvusClient();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ error: err instanceof Error ? err.message : String(err) }, 'Failed to start application');
  process.exit(1);
});
