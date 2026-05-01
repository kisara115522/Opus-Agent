/**
 * Static files middleware.
 *
 * Serves files from the `static/` directory using Hono's serveStatic.
 * For Node.js runtime, uses @hono/node-server/serve-static.
 */

import { serveStatic } from '@hono/node-server/serve-static';

/**
 * Create a static files middleware that serves from the `static/` directory.
 * Files are served at the root path (e.g., `/index.html` -> `static/index.html`).
 */
export function createStaticFilesMiddleware() {
  return serveStatic({ root: './' });
}
