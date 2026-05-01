/**
 * Server module - Barrel Export
 *
 * Exports the Hono application factory and all middleware.
 */

export { createApp, type AppDeps } from './app.js';
export { createCorsMiddleware } from './middleware/cors.js';
export { errorHandler } from './middleware/error-handler.js';
export { createStaticFilesMiddleware } from './middleware/static-files.js';
