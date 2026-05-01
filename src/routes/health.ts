/**
 * Health Routes
 *
 * Provides health check endpoints for service monitoring.
 *
 * Endpoints:
 * - GET /milvus/health - Check Milvus connectivity
 */

import { Hono } from 'hono';
import pino from 'pino';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { successResponse, errorResponse } from '../types/common.js';

const logger = pino({ name: 'health-routes' });

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface HealthRouteDeps {
  milvusClient: MilvusClient | null;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Create a Hono router with health check endpoints.
 *
 * The returned router is mounted at the root level by the server app.
 * Route path: `/milvus/health`
 */
export function createHealthRoutes(deps: HealthRouteDeps): Hono {
  const { milvusClient } = deps;
  const routes = new Hono();

  // -------------------------------------------------------------------------
  // GET /milvus/health - Milvus health check
  // -------------------------------------------------------------------------
  routes.get('/milvus/health', async (c) => {
    if (!milvusClient) {
      return c.json(
        successResponse({
          status: 'disabled',
          milvus: false,
          message: 'Milvus 未配置，知识库功能不可用',
        }),
      );
    }

    try {
      const health = await milvusClient.checkHealth();

      if (health.isHealthy) {
        logger.info('Milvus health check passed');
        return c.json(
          successResponse({
            status: 'healthy',
            milvus: true,
          }),
        );
      } else {
        logger.warn('Milvus health check failed: not healthy');
        return c.json(
          errorResponse('Milvus is not healthy'),
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Milvus health check error');
      return c.json(errorResponse(`Milvus health check failed: ${message}`));
    }
  });

  return routes;
}
