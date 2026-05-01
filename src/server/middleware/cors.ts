/**
 * CORS middleware configuration.
 *
 * Allows all origins to match the Java WebMvcConfig pattern.
 * Uses Hono's built-in cors middleware.
 */

import { cors } from 'hono/cors';

/**
 * Create a CORS middleware instance configured to allow all origins.
 * Matches Java WebMvcConfig: allowedOrigins("*"), allowedMethods("*"), allowCredentials(true).
 */
export function createCorsMiddleware() {
  return cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposeHeaders: ['Content-Type'],
    maxAge: 86400,
    credentials: false,
  });
}
