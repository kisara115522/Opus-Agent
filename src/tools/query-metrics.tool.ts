/**
 * Query metrics tool - ported from Java QueryMetricsTools.java
 *
 * Queries Prometheus for active alerts. Supports mock mode that returns
 * simulated alerts (HighCPUUsage, HighMemoryUsage, SlowResponse).
 * Real mode fetches from Prometheus /api/v1/alerts endpoint.
 */

import { tool } from 'ai';
import { z } from 'zod';
import pino from 'pino';
import type { AppConfig } from '../config/index.js';

const logger = pino({ name: 'query-metrics-tool' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SimplifiedAlert {
  alert_name: string;
  description: string;
  state: string;
  active_at: string;
  duration: string;
}

interface PrometheusAlertsOutput {
  success: boolean;
  alerts: SimplifiedAlert[];
  message: string;
  error?: string;
}

/** Raw Prometheus alert structure from /api/v1/alerts */
interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: string;
  activeAt: string;
  value?: string;
}

interface PrometheusAlertsResult {
  status: string;
  data: {
    alerts: PrometheusAlert[];
  };
  error?: string;
  errorType?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate human-readable duration from an ISO timestamp to now.
 */
function calculateDuration(activeAtStr: string): string {
  try {
    const activeAt = new Date(activeAtStr).getTime();
    const now = Date.now();
    const diffMs = now - activeAt;

    const hours = Math.floor(diffMs / 3_600_000);
    const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
    const seconds = Math.floor((diffMs % 60_000) / 1000);

    if (hours > 0) return `${hours}h${minutes}m${seconds}s`;
    if (minutes > 0) return `${minutes}m${seconds}s`;
    return `${seconds}s`;
  } catch {
    return 'unknown';
  }
}

/**
 * Build mock alert data matching the Java version.
 * Corresponds to aiops-docs alert types:
 * - HighCPUUsage, HighMemoryUsage, SlowResponse
 */
function buildMockAlerts(): SimplifiedAlert[] {
  const now = new Date();

  const cpuActiveAt = new Date(now.getTime() - 25 * 60_000);
  const memoryActiveAt = new Date(now.getTime() - 15 * 60_000);
  const slowActiveAt = new Date(now.getTime() - 10 * 60_000);

  return [
    {
      alert_name: 'HighCPUUsage',
      description:
        '服务 payment-service 的 CPU 使用率持续超过 80%，当前值为 92%。' +
        '实例: pod-payment-service-7d8f9c6b5-x2k4m，命名空间: production',
      state: 'firing',
      active_at: cpuActiveAt.toISOString(),
      duration: calculateDuration(cpuActiveAt.toISOString()),
    },
    {
      alert_name: 'HighMemoryUsage',
      description:
        '服务 order-service 的内存使用率持续超过 85%，当前值为 91%。' +
        'JVM堆内存使用: 3.8GB/4GB，可能存在内存泄漏风险。' +
        '实例: pod-order-service-5c7d8e9f1-m3n2p，命名空间: production',
      state: 'firing',
      active_at: memoryActiveAt.toISOString(),
      duration: calculateDuration(memoryActiveAt.toISOString()),
    },
    {
      alert_name: 'SlowResponse',
      description:
        '服务 user-service 的 P99 响应时间持续超过 3 秒，当前值为 4.2 秒。' +
        '受影响接口: /api/v1/users/profile, /api/v1/users/orders。' +
        '可能原因：数据库慢查询或下游服务延迟',
      state: 'firing',
      active_at: slowActiveAt.toISOString(),
      duration: calculateDuration(slowActiveAt.toISOString()),
    },
  ];
}

/**
 * Fetch alerts from Prometheus /api/v1/alerts endpoint.
 */
async function fetchPrometheusAlerts(
  baseUrl: string,
  timeoutSeconds: number,
): Promise<PrometheusAlertsResult> {
  const apiUrl = `${baseUrl}/api/v1/alerts`;
  logger.debug({ apiUrl }, 'Requesting Prometheus alerts API');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP request failed with status ${response.status}`);
    }

    const data = (await response.json()) as PrometheusAlertsResult;
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Build an error response matching the Java output format.
 */
function buildErrorResponse(message: string, error?: string): PrometheusAlertsOutput {
  return {
    success: false,
    alerts: [],
    message,
    error,
  };
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

/**
 * Creates the queryPrometheusAlerts tool.
 *
 * @param config - Application config (reads prometheus.baseUrl, prometheus.timeout, prometheus.mockEnabled)
 */
export function createQueryMetricsTool(config: AppConfig) {
  const { baseUrl, timeout, mockEnabled } = config.prometheus;

  return tool({
    description:
      'Query active alerts from Prometheus alerting system. ' +
      'This tool retrieves all currently active/firing alerts including their labels, annotations, state, and values. ' +
      'Use this tool when you need to check what alerts are currently firing, investigate alert conditions, or monitor alert status.',
    parameters: z.object({}),
    execute: async (): Promise<PrometheusAlertsOutput> => {
      logger.info({ mockEnabled }, 'Executing queryPrometheusAlerts tool');

      try {
        let simplifiedAlerts: SimplifiedAlert[];

        if (mockEnabled) {
          simplifiedAlerts = buildMockAlerts();
          logger.info(
            { count: simplifiedAlerts.length },
            'Using mock data for Prometheus alerts',
          );
        } else {
          const result = await fetchPrometheusAlerts(baseUrl, timeout);

          if (result.status !== 'success') {
            return buildErrorResponse(
              `Prometheus API returned non-success status: ${result.status}`,
              result.error,
            );
          }

          // Deduplicate by alertname, keeping the first occurrence
          const seenAlertNames = new Set<string>();
          simplifiedAlerts = [];

          for (const alert of result.data.alerts) {
            const alertName = alert.labels?.alertname;
            if (!alertName || seenAlertNames.has(alertName)) continue;

            seenAlertNames.add(alertName);

            simplifiedAlerts.push({
              alert_name: alertName,
              description: alert.annotations?.description ?? '',
              state: alert.state,
              active_at: alert.activeAt,
              duration: calculateDuration(alert.activeAt),
            });
          }
        }

        logger.info(
          { count: simplifiedAlerts.length },
          'Prometheus alerts query complete',
        );

        return {
          success: true,
          alerts: simplifiedAlerts,
          message: `成功检索到 ${simplifiedAlerts.length} 个活动告警`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'Failed to query Prometheus alerts');
        return buildErrorResponse('查询失败', message);
      }
    },
  });
}
