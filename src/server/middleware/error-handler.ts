/**
 * Global error handler middleware.
 *
 * Catches all unhandled errors and returns structured JSON responses
 * matching the CommonResponse envelope. Logs errors with Pino.
 */

import type { ErrorHandler } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import pino from 'pino';
import { errorResponse } from '../../types/common.js';

const logger = pino({ name: 'error-handler' });

/**
 * Hono global error handler.
 *
 * Returns JSON in CommonResponse format:
 * ```json
 * { "code": 500, "message": "...", "data": null }
 * ```
 */
export const errorHandler: ErrorHandler = (err, c) => {
  // Determine status code from Hono HTTPException or default to 500
  const status =
    'status' in err && typeof err.status === 'number' ? err.status : 500;

  // Log the error with context
  logger.error(
    {
      message: err.message,
      status,
      path: c.req.path,
      method: c.req.method,
      stack: err.stack,
    },
    'Unhandled error',
  );

  // Return structured JSON error response
  const body = errorResponse(err.message, status);
  return c.json(body, status as StatusCode);
};
