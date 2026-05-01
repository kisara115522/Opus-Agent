/**
 * Hono Application
 *
 * Assembles the complete HTTP server:
 * - Registers middleware (CORS, error handler, static files)
 * - Mounts route groups (chat API, health checks)
 * - Exports the configured Hono app instance
 */

import { Hono } from 'hono';
import type { AppConfig } from '../config/index.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { Tool } from 'ai';
import { createCorsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/error-handler.js';
import { createStaticFilesMiddleware } from './middleware/static-files.js';
import { createChatRoutes } from '../routes/chat.js';
import { createHealthRoutes } from '../routes/health.js';
import { createReleaseRoutes } from '../routes/release.js';
import { createReviewRouter } from '../routes/review.js';
import { TOOL_QUERY_PROMETHEUS_ALERTS, TOOL_QUERY_INTERNAL_DOCS } from '../tools/index.js';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface AppDeps {
  config: AppConfig;
  providerRegistry: ProviderRegistry;
  milvusClient: MilvusClient;
  tools: Record<string, Tool>;
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

/**
 * Create and configure the Hono application.
 *
 * Middleware order:
 * 1. CORS (must be first to handle preflight requests)
 * 2. Error handler (catches all unhandled errors)
 *
 * Route groups:
 * - `/api/*` - Chat API endpoints
 * - `/milvus/*` - Health check endpoints
 * - `/*` - Static files (must be last as a catch-all)
 */
export function createApp(deps: AppDeps): Hono {
  const { config, providerRegistry, milvusClient, tools } = deps;
  const app = new Hono();

  // -------------------------------------------------------------------------
  // Middleware
  // -------------------------------------------------------------------------

  // CORS - must be registered before routes
  app.use('*', createCorsMiddleware());

  // Global error handler
  app.onError(errorHandler);

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  // Chat API routes (mounted at /api/*)
  const chatRoutes = createChatRoutes({ providerRegistry, config, tools });
  app.route('/api', chatRoutes);

  // Release precheck routes (mounted at /api/*)
  const releaseRoutes = createReleaseRoutes({
    config,
    queryMetricsTool: tools[TOOL_QUERY_PROMETHEUS_ALERTS],
    internalDocsTool: tools[TOOL_QUERY_INTERNAL_DOCS],
  });
  app.route('/api', releaseRoutes);

  // Code review routes (mounted at root for /api/code-review/*)
  // TODO: Replace stub with real codeReviewService once the code review agent is ready
  const reviewRouter = createReviewRouter({
    codeReviewService: {
      review: async (_request, _progress) => {
        throw new Error('Code review service not yet implemented');
      },
      getById: async (_id) => null,
      latest: async (_limit) => [],
    },
    config: { codeReview: config.code.review },
  });
  app.route('/', reviewRouter);

  // Health check routes (mounted at root)
  const healthRoutes = createHealthRoutes({ milvusClient });
  app.route('/', healthRoutes);

  // -------------------------------------------------------------------------
  // Static files (must be last - catch-all for unmatched routes)
  // -------------------------------------------------------------------------

  app.use('/*', createStaticFilesMiddleware());

  return app;
}
