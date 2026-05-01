/**
 * AIOps Routes
 *
 * Endpoints:
 * - POST /api/ai_ops - SSE streaming auto-analysis
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import pino from 'pino';
import type { AiOpsService } from '../services/ai-ops.service.js';
import { successResponse, errorResponse } from '../types/common.js';

const logger = pino({ name: 'ai-ops-routes' });

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface AiOpsRouteDeps {
  aiOpsService: AiOpsService;
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createAiOpsRoutes(deps: AiOpsRouteDeps): Hono {
  const { aiOpsService } = deps;
  const routes = new Hono();

  /**
   * POST /ai_ops - SSE streaming auto-analysis
   *
   * Triggers an automatic AIOps analysis. No request body needed.
   * Streams progress updates and the final report via SSE.
   */
  routes.post('/ai_ops', (c) => {
    return streamSSE(c, async (stream) => {
      try {
        const result = await aiOpsService.analyze((msg) => {
          stream.writeSSE({ event: 'message', data: JSON.stringify({ type: 'progress', data: msg }) });
        });

        if (result.success) {
          // Send the final report
          await stream.writeSSE({
            event: 'message',
            data: JSON.stringify({ type: 'report', data: result.report }),
          });
          await stream.writeSSE({
            event: 'message',
            data: JSON.stringify({
              type: 'done',
              data: { stepsExecuted: result.stepsExecuted, toolCalls: result.toolCalls },
            }),
          });
        } else {
          await stream.writeSSE({
            event: 'message',
            data: JSON.stringify({ type: 'error', data: result.error }),
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'AIOps SSE stream error');
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({ type: 'error', data: message }),
        });
      }
    });
  });

  return routes;
}
