/**
 * Release Routes - ported from Java ReleaseController.java
 *
 * Endpoints:
 * - POST /api/release/precheck                - Synchronous precheck
 * - POST /api/release/precheck/stream         - SSE streaming precheck
 * - GET  /api/release/precheck/:id            - Get precheck by ID
 * - POST /api/release/precheck/:id/feedback   - Submit feedback
 * - GET  /api/release/precheck                - List recent prechecks
 * - GET  /api/release/precheck/config         - Get precheck config (weights)
 * - POST /api/release/precheck/config/weights - Update score weights
 * - GET  /api/release/precheck/config/weights/audit - Weight change audit log
 *
 * Uses same route pattern as chat.ts (dependency injection via interface).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import pino from 'pino';
import type { AppConfig } from '../config/index.js';
import type { Tool } from 'ai';
import type { ReleasePrecheckRequest, PrecheckFeedbackRequest } from '../types/release.js';
import { ReleasePrecheckService } from '../services/release-precheck.service.js';
import { PrecheckWeightAuditService } from '../services/precheck-weight-audit.service.js';
import { successResponse, errorResponse } from '../types/common.js';

const logger = pino({ name: 'release-routes' });

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReleaseRouteDeps {
  config: AppConfig;
  queryMetricsTool: Tool;
  internalDocsTool: Tool;
}

// ---------------------------------------------------------------------------
// Config response type (matching Java ReleasePrecheckConfigResponse)
// ---------------------------------------------------------------------------

interface ReleasePrecheckConfigResponse {
  enabled: boolean;
  defaultTimeout: number;
  historyFile: string;
  weightAuditFile: string;
  scoreWeights: Record<string, number>;
  requiredEvidence: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Create a Hono router with all release precheck endpoints.
 *
 * The returned router is mounted at `/api` by the server app.
 * Route paths are relative: `/release/precheck`, etc.
 */
export function createReleaseRoutes(deps: ReleaseRouteDeps): Hono {
  const { config, queryMetricsTool, internalDocsTool } = deps;
  const routes = new Hono();

  const precheckService = new ReleasePrecheckService({
    config,
    queryMetricsTool,
    internalDocsTool,
  });

  const weightAuditService = new PrecheckWeightAuditService(
    config.release.precheck.weightAuditFile,
  );

  // In-memory weight overrides (matching Java behavior: in-memory only, resets on restart)
  let scoreWeightsOverride: Record<string, number> | null = null;

  // -------------------------------------------------------------------------
  // POST /release/precheck - Synchronous precheck
  // -------------------------------------------------------------------------
  routes.post('/release/precheck', async (c) => {
    try {
      const body = await c.req.json<ReleasePrecheckRequest>();

      logger.info(
        { service: body.serviceName, env: body.environment },
        'Received precheck request',
      );

      const result = await precheckService.runPrecheck(body);

      return c.json(successResponse(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('不能为空')) {
        logger.warn({ error: message }, '发布预检请求参数错误');
        return c.json(errorResponse(message, 400));
      }

      logger.error({ error: message }, '发布预检失败');
      return c.json(errorResponse(`发布预检失败: ${message}`));
    }
  });

  // -------------------------------------------------------------------------
  // POST /release/precheck/stream - SSE streaming precheck
  // -------------------------------------------------------------------------
  routes.post('/release/precheck/stream', async (c) => {
    const body = await c.req.json<ReleasePrecheckRequest>();

    logger.info(
      { service: body.serviceName, env: body.environment },
      'Received streaming precheck request',
    );

    return streamSSE(c, async (stream) => {
      // Timeout matching Java defaultTimeout
      const timeout = setTimeout(() => {
        logger.warn('SSE stream timeout');
        stream.close();
      }, config.release.precheck.defaultTimeout);

      stream.onAbort(() => {
        logger.info('SSE stream aborted by client');
        clearTimeout(timeout);
      });

      try {
        const result = await precheckService.runPrecheck(body, (message) => {
          // Send progress messages as SSE events
          stream.writeSSE({
            data: JSON.stringify({ type: 'content', data: `${message}\n` }),
            event: 'message',
          });
        });

        // Send separator and full report
        await stream.writeSSE({
          data: JSON.stringify({
            type: 'content',
            data: `\n${'='.repeat(50)}\n`,
          }),
          event: 'message',
        });

        await stream.writeSSE({
          data: JSON.stringify({
            type: 'content',
            data: result.reportMarkdown,
          }),
          event: 'message',
        });

        // Send done signal
        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', data: null }),
          event: 'message',
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, '流式发布预检失败');

        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', data: `发布预检失败: ${message}` }),
          event: 'message',
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  });

  // -------------------------------------------------------------------------
  // GET /release/precheck/:id - Get precheck by ID
  // -------------------------------------------------------------------------
  routes.get('/release/precheck/:id', async (c) => {
    try {
      const id = c.req.param('id');

      logger.info({ id }, 'Received get precheck request');

      const result = await precheckService.getPrecheckById(id);
      if (!result) {
        return c.json(errorResponse(`预检记录不存在: ${id}`, 404));
      }

      return c.json(successResponse(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Get precheck failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // POST /release/precheck/:id/feedback - Submit feedback
  // -------------------------------------------------------------------------
  routes.post('/release/precheck/:id/feedback', async (c) => {
    try {
      const id = c.req.param('id');
      const body = await c.req.json<PrecheckFeedbackRequest>();

      logger.info({ id }, 'Received feedback submission');

      const result = await precheckService.saveFeedback(id, body);
      if (!result) {
        return c.json(errorResponse(`预检记录不存在: ${id}`, 404));
      }

      return c.json(successResponse(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Save feedback failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // GET /release/precheck - List recent prechecks
  // -------------------------------------------------------------------------
  routes.get('/release/precheck', async (c) => {
    try {
      const limitParam = c.req.query('limit');
      const limit = Math.max(1, parseInt(limitParam ?? '20', 10) || 20);

      const results = await precheckService.latest(limit);
      return c.json(successResponse(results));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'List prechecks failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // GET /release/precheck/config - Get precheck config
  // -------------------------------------------------------------------------
  routes.get('/release/precheck/config', async (c) => {
    try {
      const configResponse = buildConfigResponse(config, scoreWeightsOverride);
      return c.json(successResponse(configResponse));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Get precheck config failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // POST /release/precheck/config/weights - Update score weights
  // -------------------------------------------------------------------------
  routes.post('/release/precheck/config/weights', async (c) => {
    try {
      const operator = c.req.header('X-Operator') ?? undefined;
      const body = await c.req.json<Record<string, number>>();

      if (!body || Object.keys(body).length === 0) {
        return c.json(errorResponse('scoreWeights 不能为空', 400));
      }

      // Validate weight values
      for (const [key, weight] of Object.entries(body)) {
        if (weight === null || weight === undefined || weight < 0 || weight > 100) {
          return c.json(errorResponse(`权重必须在 0-100 范围内: ${key}`, 400));
        }
      }

      // Get current weights (base config + overrides)
      const currentWeights = {
        ...config.release.precheck.scoreWeights,
        ...(scoreWeightsOverride ?? {}),
      };

      // Apply new overrides
      scoreWeightsOverride = {
        ...(scoreWeightsOverride ?? {}),
        ...body,
      };

      const mergedWeights = {
        ...config.release.precheck.scoreWeights,
        ...scoreWeightsOverride,
      };

      logger.info({ weights: body }, '发布预检评分权重已更新');

      // Record audit
      await weightAuditService.recordWeightChange(
        operator ?? 'unknown',
        currentWeights,
        body,
        mergedWeights,
      );

      const configResponse = buildConfigResponse(config, scoreWeightsOverride);
      return c.json(successResponse(configResponse));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Update score weights failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // GET /release/precheck/config/weights/audit - Weight change audit log
  // -------------------------------------------------------------------------
  routes.get('/release/precheck/config/weights/audit', async (c) => {
    try {
      const limitParam = c.req.query('limit');
      const limit = Math.max(1, parseInt(limitParam ?? '20', 10) || 20);

      const records = await weightAuditService.latest(limit);
      return c.json(successResponse(records));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Get weight audit log failed');
      return c.json(errorResponse(message));
    }
  });

  return routes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildConfigResponse(
  config: AppConfig,
  overrides: Record<string, number> | null,
): ReleasePrecheckConfigResponse {
  const precheck = config.release.precheck;
  return {
    enabled: precheck.enabled,
    defaultTimeout: precheck.defaultTimeout,
    historyFile: precheck.historyFile,
    weightAuditFile: precheck.weightAuditFile,
    scoreWeights: {
      ...precheck.scoreWeights,
      ...(overrides ?? {}),
    },
    requiredEvidence: {
      deploymentHistory: precheck.requiredEvidence.deploymentHistory,
      serviceBaseline: precheck.requiredEvidence.serviceBaseline,
      rollbackRunbook: precheck.requiredEvidence.rollbackRunbook,
    },
  };
}
