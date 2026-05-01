/**
 * DateTime tool - ported from Java DateTimeTools.java
 *
 * Returns the current date and time in the user's timezone.
 * No input parameters required.
 */

import { tool } from 'ai';
import { z } from 'zod';
import pino from 'pino';

const logger = pino({ name: 'datetime-tool' });

/**
 * Creates the getCurrentDateTime tool.
 * Returns the current date/time formatted in the local timezone.
 */
export function createDateTimeTool() {
  return tool({
    description: 'Get the current date and time in the user\'s timezone',
    parameters: z.object({}),
    execute: async () => {
      logger.debug('Executing getCurrentDateTime tool');

      const now = new Date();
      const formatted = now.toLocaleString('zh-CN', {
        timeZone: process.env.TZ || 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      // Also include ISO format for machine parsing
      const isoString = now.toISOString();

      logger.info({ formatted, isoString }, 'Current datetime retrieved');

      return {
        formatted,
        iso: isoString,
        timezone: process.env.TZ || 'Asia/Shanghai',
      };
    },
  });
}
