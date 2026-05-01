/**
 * Routes module - Barrel Export
 *
 * Exports all route factories and their dependency types.
 */

export { createChatRoutes, type ChatRouteDeps } from './chat.js';
export { createHealthRoutes, type HealthRouteDeps } from './health.js';
export { createReleaseRoutes, type ReleaseRouteDeps } from './release.js';
