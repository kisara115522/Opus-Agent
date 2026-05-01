/**
 * Review Routes - ported from Java CodeReviewController.java
 *
 * Endpoints:
 * - POST /api/code-review/analyze         - Synchronous review
 * - POST /api/code-review/analyze/stream  - SSE streaming review
 * - GET  /api/code-review/:id             - Get review by ID
 * - GET  /api/code-review                 - List latest reviews
 * - GET  /api/code-review/config          - Get review config
 * - POST /api/code-review/feedback        - Submit feedback (stub)
 * - GET  /api/code-review/export/:id      - Export review as markdown
 * - GET  /api/code-review/health          - Health check
 *
 * Uses the same route pattern as chat.ts and release.ts (dependency injection via interface).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import pino from 'pino';
import type { CodeReviewRequest, CodeReviewResult, CodeReviewConfigResponse } from '../types/review.js';
import { successResponse, errorResponse } from '../types/common.js';

const logger = pino({ name: 'review-routes' });

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ReviewRouteDeps {
  codeReviewService: {
    review: (request: CodeReviewRequest, progress?: (msg: string) => void) => Promise<CodeReviewResult>;
    getById: (id: string) => Promise<CodeReviewResult | null>;
    latest: (limit: number) => Promise<CodeReviewResult[]>;
  };
  config: {
    codeReview: {
      enabled: boolean;
      defaultTimeout: number;
      commandTimeoutSeconds: number;
      historyFile: string;
      maxCommits: number;
      maxFiles: number;
      maxPatchCharsPerFile: number;
      blockScore: number;
      ragEvidenceEnabled: boolean;
      ragQueriesPerReview: number;
      agentEnabled: boolean;
      agentMaxFiles: number;
      agentMaxPatchCharsPerFile: number;
      requireAllowedRoots: boolean;
      allowedRoots: string[];
    };
  };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Create a Hono router with all code review endpoints.
 *
 * The returned router is mounted at `/` by the server app.
 * Route paths are absolute: `/api/code-review/*`.
 */
export function createReviewRouter(deps: ReviewRouteDeps): Hono {
  const { codeReviewService, config } = deps;
  const routes = new Hono();

  // -------------------------------------------------------------------------
  // POST /api/code-review/analyze - Synchronous review
  // -------------------------------------------------------------------------
  routes.post('/api/code-review/analyze', async (c) => {
    try {
      const body = await c.req.json<CodeReviewRequest>();

      logger.info(
        { projectPath: body.projectPath, baseRef: body.baseRef, headRef: body.headRef },
        'Received code review request',
      );

      // Basic validation
      if (!body.projectPath?.trim()) {
        return c.json(errorResponse('projectPath cannot be empty', 400));
      }
      if (!body.baseRef?.trim()) {
        return c.json(errorResponse('baseRef cannot be empty', 400));
      }

      const result = await codeReviewService.review(body);

      return c.json(successResponse(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('cannot be empty') || message.includes('permission')) {
        logger.warn({ error: message }, 'Code review validation error');
        return c.json(errorResponse(message, 400));
      }

      logger.error({ error: message }, 'Code review failed');
      return c.json(errorResponse(`Code review failed: ${message}`));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/code-review/analyze/stream - SSE streaming review
  // -------------------------------------------------------------------------
  routes.post('/api/code-review/analyze/stream', async (c) => {
    const body = await c.req.json<CodeReviewRequest>();

    logger.info(
      { projectPath: body.projectPath, baseRef: body.baseRef, headRef: body.headRef },
      'Received streaming code review request',
    );

    return streamSSE(c, async (stream) => {
      // 5-minute timeout
      const timeout = setTimeout(() => {
        logger.warn('SSE stream timeout');
        stream.close();
      }, 300_000);

      stream.onAbort(() => {
        logger.info('SSE stream aborted by client');
        clearTimeout(timeout);
      });

      try {
        const result = await codeReviewService.review(body, (message) => {
          // Send progress messages as SSE events
          stream.writeSSE({
            data: JSON.stringify({ type: 'content', data: message }),
            event: 'message',
          });
        });

        // Send final report
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
        logger.error({ error: message }, 'Streaming code review failed');

        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', data: `Code review failed: ${message}` }),
          event: 'message',
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/code-review/:id - Get review by ID
  // -------------------------------------------------------------------------
  routes.get('/api/code-review/:id', async (c) => {
    try {
      const id = c.req.param('id');

      logger.info({ id }, 'Received get review request');

      const result = await codeReviewService.getById(id);
      if (!result) {
        return c.json(errorResponse(`Review not found: ${id}`, 404));
      }

      return c.json(successResponse(result));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Get review failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/code-review - List latest reviews
  // -------------------------------------------------------------------------
  routes.get('/api/code-review', async (c) => {
    try {
      const limitParam = c.req.query('limit');
      const limit = Math.max(1, parseInt(limitParam ?? '20', 10) || 20);

      const results = await codeReviewService.latest(limit);
      return c.json(successResponse(results));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'List reviews failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/code-review/config - Get review config
  // -------------------------------------------------------------------------
  routes.get('/api/code-review/config', async (c) => {
    try {
      const reviewConfig = config.codeReview;
      const configResponse: CodeReviewConfigResponse = {
        enabled: reviewConfig.enabled,
        defaultTimeout: reviewConfig.defaultTimeout,
        commandTimeoutSeconds: reviewConfig.commandTimeoutSeconds,
        maxCommits: reviewConfig.maxCommits,
        maxFiles: reviewConfig.maxFiles,
        maxPatchCharsPerFile: reviewConfig.maxPatchCharsPerFile,
        blockScore: reviewConfig.blockScore,
        ragEvidenceEnabled: reviewConfig.ragEvidenceEnabled,
        ragQueriesPerReview: reviewConfig.ragQueriesPerReview,
        agentEnabled: reviewConfig.agentEnabled,
        agentMaxFiles: reviewConfig.agentMaxFiles,
        agentMaxPatchCharsPerFile: reviewConfig.agentMaxPatchCharsPerFile,
        historyFile: reviewConfig.historyFile,
        requireAllowedRoots: reviewConfig.requireAllowedRoots,
        allowedRoots: reviewConfig.allowedRoots,
      };

      return c.json(successResponse(configResponse));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Get review config failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/code-review/feedback - Submit feedback (stub)
  // -------------------------------------------------------------------------
  routes.post('/api/code-review/feedback', async (c) => {
    logger.info('Received feedback submission (stub)');
    return c.json(successResponse('OK'));
  });

  // -------------------------------------------------------------------------
  // GET /api/code-review/export/:id - Export review as markdown
  // -------------------------------------------------------------------------
  routes.get('/api/code-review/export/:id', async (c) => {
    try {
      const id = c.req.param('id');

      logger.info({ id }, 'Received export review request');

      const result = await codeReviewService.getById(id);
      if (!result) {
        return c.json(errorResponse(`Review not found: ${id}`, 404));
      }

      return c.text(result.reportMarkdown, 200, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Export review failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/code-review/health - Health check
  // -------------------------------------------------------------------------
  routes.get('/api/code-review/health', async (c) => {
    return c.json(successResponse({ enabled: config.codeReview.enabled }));
  });

  return routes;
}
