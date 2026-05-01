/**
 * Query logs tool - ported from Java QueryLogsTools.java
 *
 * Provides two tools:
 * - getAvailableLogTopics: lists available log topics
 * - queryLogs: queries cloud logs (currently mock-only with realistic data)
 *
 * Mock data is organized by topic and query keywords, matching alert types.
 */

import { tool } from 'ai';
import { z } from 'zod';
import pino from 'pino';
import type { AppConfig } from '../config/index.js';

const logger = pino({ name: 'query-logs-tool' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogEntry {
  timestamp: string;
  level: string;
  service: string;
  instance: string;
  message: string;
  metrics: Record<string, string>;
}

interface LogTopicInfo {
  topic_name: string;
  description: string;
  example_queries: string[];
  related_alerts: string[];
}

interface LogTopicsOutput {
  success: boolean;
  topics: LogTopicInfo[];
  available_regions: string[];
  default_region: string;
  message: string;
}

interface QueryLogsOutput {
  success: boolean;
  region: string;
  log_topic: string;
  query: string;
  logs: LogEntry[];
  total: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_REGIONS = ['ap-guangzhou', 'ap-shanghai', 'ap-beijing', 'ap-chengdu'] as const;
const DEFAULT_REGION = 'ap-guangzhou';

const FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(date: Date): string {
  return FORMATTER.format(date).replace(/\//g, '-');
}

function buildErrorResponse(message: string): QueryLogsOutput {
  return {
    success: false,
    region: '',
    log_topic: '',
    query: '',
    logs: [],
    total: 0,
    message,
  };
}

// ---------------------------------------------------------------------------
// Mock log builders
// ---------------------------------------------------------------------------

function buildSystemMetricsLogs(now: Date, query: string, limit: number): LogEntry[] {
  const logs: LogEntry[] = [];

  // CPU related logs
  if (query.includes('cpu') || query.includes('>80')) {
    for (let i = 0; i < 5; i++) {
      const ts = new Date(now.getTime() - i * 2 * 60_000);
      const cpuUsage = (92.0 - i * 1.5).toFixed(1);
      logs.push({
        timestamp: formatTimestamp(ts),
        level: 'WARN',
        service: 'payment-service',
        instance: 'pod-payment-service-7d8f9c6b5-x2k4m',
        message: `CPU使用率过高: ${cpuUsage}%, 进程: java (PID: 1), 线程数: 245`,
        metrics: {
          cpu_usage: cpuUsage,
          cpu_cores: '4',
          load_average_1m: '3.82',
          load_average_5m: '3.65',
          top_process: 'java',
          process_threads: '245',
        },
      });
    }
  }

  // Memory related logs
  if (query.includes('memory') || query.includes('>85') || query.includes('oom')) {
    for (let i = 0; i < 5; i++) {
      const ts = new Date(now.getTime() - i * 3 * 60_000);
      const memUsage = (91.0 - i * 1.2).toFixed(1);
      const heapUsed = (3.8 - i * 0.1).toFixed(1);
      const gcCount = (128 - i * 5).toString();
      logs.push({
        timestamp: formatTimestamp(ts),
        level: 'WARN',
        service: 'order-service',
        instance: 'pod-order-service-5c7d8e9f1-m3n2p',
        message: `内存使用率过高: ${memUsage}%, JVM堆内存: ${heapUsed}GB/4GB, GC次数: ${gcCount}`,
        metrics: {
          memory_usage: memUsage,
          jvm_heap_used: `${heapUsed}GB`,
          jvm_heap_max: '4GB',
          gc_count: gcCount,
          gc_time_ms: String(1250 + i * 50),
        },
      });
    }

    // GC warning log
    const gcTs = new Date(now.getTime() - 8 * 60_000);
    logs.push({
      timestamp: formatTimestamp(gcTs),
      level: 'WARN',
      service: 'order-service',
      instance: 'pod-order-service-5c7d8e9f1-m3n2p',
      message: '频繁 Full GC 警告: 过去10分钟内发生 15 次 Full GC, 平均耗时 850ms, 建议检查内存泄漏',
      metrics: {
        full_gc_count: '15',
        avg_gc_time_ms: '850',
        survivor_space: '95%',
        old_gen: '89%',
      },
    });
  }

  // Disk related logs
  if (query.includes('disk') || query.includes('filesystem')) {
    for (let i = 0; i < 3; i++) {
      const ts = new Date(now.getTime() - i * 5 * 60_000);
      const diskUsage = (85.0 + i * 2).toFixed(1);
      const diskAvail = (15.0 - i * 2).toFixed(1);
      logs.push({
        timestamp: formatTimestamp(ts),
        level: 'WARN',
        service: 'log-collector',
        instance: 'node-worker-01',
        message: `磁盘使用率告警: /data 分区使用率 ${diskUsage}%, 可用空间: ${diskAvail}GB`,
        metrics: {
          disk_usage: `${diskUsage}%`,
          disk_available: `${diskAvail}GB`,
          disk_total: '100GB',
          mount_point: '/data',
          largest_dir: '/data/logs',
        },
      });
    }
  }

  return logs;
}

function buildApplicationLogs(now: Date, query: string, _limit: number): LogEntry[] {
  const logs: LogEntry[] = [];

  // ERROR level logs
  if (query.includes('error') || query.includes('fatal') || query.includes('500')) {
    const dbTs = new Date(now.getTime() - 5 * 60_000);
    logs.push({
      timestamp: formatTimestamp(dbTs),
      level: 'ERROR',
      service: 'order-service',
      instance: 'pod-order-service-5c7d8e9f1-m3n2p',
      message:
        '数据库连接池耗尽: Cannot acquire connection from pool, ' +
        'active: 50/50, waiting: 23, timeout: 30000ms',
      metrics: {
        error_type: 'ConnectionPoolExhaustedException',
        pool_active: '50',
        pool_max: '50',
        waiting_threads: '23',
      },
    });

    const oomTs = new Date(now.getTime() - 12 * 60_000);
    logs.push({
      timestamp: formatTimestamp(oomTs),
      level: 'FATAL',
      service: 'order-service',
      instance: 'pod-order-service-5c7d8e9f1-m3n2p',
      message:
        'java.lang.OutOfMemoryError: Java heap space at ' +
        'com.example.order.service.OrderService.processLargeOrder(OrderService.java:156)',
      metrics: {
        error_type: 'OutOfMemoryError',
        heap_used: '3.9GB',
        heap_max: '4GB',
        stack_trace: 'OrderService.processLargeOrder -> OrderRepository.findByCondition -> HikariPool.getConnection',
      },
    });

    for (let i = 0; i < 3; i++) {
      const ts = new Date(now.getTime() - (3 + i) * 60_000);
      const duration = 5200 + i * 300;
      logs.push({
        timestamp: formatTimestamp(ts),
        level: 'ERROR',
        service: 'user-service',
        instance: 'pod-user-service-8e9f0a1b2-k5j6h',
        message: `HTTP 500 Internal Server Error: /api/v1/users/profile, 耗时: ${duration}ms, 错误: Database query timeout`,
        metrics: {
          http_status: '500',
          uri: '/api/v1/users/profile',
          method: 'GET',
          duration_ms: String(duration),
          error_cause: 'QueryTimeoutException',
        },
      });
    }
  }

  // Slow response logs
  if (query.includes('response_time') || query.includes('slow') || query.includes('>3000')) {
    for (let i = 0; i < 5; i++) {
      const ts = new Date(now.getTime() - i * 2 * 60_000);
      const uri = i % 2 === 0 ? '/api/v1/users/profile' : '/api/v1/users/orders';
      const responseTime = 4200 - i * 150;
      const dbTime = 3800 - i * 100;
      logs.push({
        timestamp: formatTimestamp(ts),
        level: 'WARN',
        service: 'user-service',
        instance: 'pod-user-service-8e9f0a1b2-k5j6h',
        message: `慢请求警告: ${uri}, 响应时间: ${responseTime}ms, 阈值: 3000ms`,
        metrics: {
          uri,
          response_time_ms: String(responseTime),
          threshold_ms: '3000',
          db_time_ms: String(dbTime),
          cache_hit: 'false',
        },
      });
    }
  }

  // Downstream dependency logs
  if (
    query.includes('downstream') ||
    query.includes('redis') ||
    query.includes('database') ||
    query.includes('mq')
  ) {
    const redisTs = new Date(now.getTime() - 7 * 60_000);
    logs.push({
      timestamp: formatTimestamp(redisTs),
      level: 'ERROR',
      service: 'payment-service',
      instance: 'pod-payment-service-7d8f9c6b5-x2k4m',
      message: 'Redis 连接超时: 无法连接到 Redis 集群, 节点: redis-cluster-01:6379, 超时: 3000ms',
      metrics: {
        dependency: 'redis',
        host: 'redis-cluster-01:6379',
        timeout_ms: '3000',
        retry_count: '3',
      },
    });

    const mqTs = new Date(now.getTime() - 9 * 60_000);
    logs.push({
      timestamp: formatTimestamp(mqTs),
      level: 'WARN',
      service: 'order-service',
      instance: 'pod-order-service-5c7d8e9f1-m3n2p',
      message: '消息队列积压警告: 队列 order-process-queue 积压消息数: 15823, 消费速率下降',
      metrics: {
        dependency: 'rabbitmq',
        queue: 'order-process-queue',
        pending_messages: '15823',
        consumer_count: '3',
      },
    });
  }

  return logs;
}

function buildDatabaseSlowQueryLogs(now: Date, _query: string, _limit: number): LogEntry[] {
  const logs: LogEntry[] = [];

  const ts1 = new Date(now.getTime() - 3 * 60_000);
  logs.push({
    timestamp: formatTimestamp(ts1),
    level: 'WARN',
    service: 'mysql',
    instance: 'mysql-primary-01',
    message:
      '慢查询: SELECT * FROM orders WHERE user_id = ? AND status IN (?, ?, ?) ' +
      'ORDER BY created_at DESC LIMIT 100, 执行时间: 3.2s, 扫描行数: 1,245,678',
    metrics: {
      query_time_sec: '3.2',
      rows_examined: '1245678',
      rows_returned: '100',
      index_used: 'idx_user_id',
      table: 'orders',
      query_type: 'SELECT',
    },
  });

  const ts2 = new Date(now.getTime() - 6 * 60_000);
  logs.push({
    timestamp: formatTimestamp(ts2),
    level: 'WARN',
    service: 'mysql',
    instance: 'mysql-primary-01',
    message:
      '慢查询: SELECT u.*, p.* FROM users u LEFT JOIN user_profiles p ON u.id = p.user_id ' +
      'WHERE u.last_login > ?, 执行时间: 2.8s, 全表扫描',
    metrics: {
      query_time_sec: '2.8',
      rows_examined: '856234',
      rows_returned: '45678',
      index_used: 'NONE',
      table: 'users, user_profiles',
      query_type: 'SELECT',
      warning: 'Full table scan detected',
    },
  });

  const ts3 = new Date(now.getTime() - 8 * 60_000);
  logs.push({
    timestamp: formatTimestamp(ts3),
    level: 'WARN',
    service: 'mysql',
    instance: 'mysql-primary-01',
    message:
      '慢查询: UPDATE orders SET status = ? WHERE created_at < ? AND status = ?, ' +
      '执行时间: 4.5s, 锁等待时间: 2.1s',
    metrics: {
      query_time_sec: '4.5',
      lock_time_sec: '2.1',
      rows_affected: '23456',
      table: 'orders',
      query_type: 'UPDATE',
      warning: 'High lock contention',
    },
  });

  return logs;
}

function buildSystemEventsLogs(now: Date, query: string, _limit: number): LogEntry[] {
  const logs: LogEntry[] = [];

  if (query.includes('restart') || query.includes('crash') || query.includes('oom_kill')) {
    const restartTs = new Date(now.getTime() - 15 * 60_000);
    logs.push({
      timestamp: formatTimestamp(restartTs),
      level: 'WARN',
      service: 'kubernetes',
      instance: 'kube-controller-manager',
      message:
        'Pod 重启事件: pod-order-service-5c7d8e9f1-m3n2p, 原因: OOMKilled, ' +
        '容器退出码: 137, 重启次数: 3',
      metrics: {
        event_type: 'PodRestart',
        pod: 'pod-order-service-5c7d8e9f1-m3n2p',
        reason: 'OOMKilled',
        exit_code: '137',
        restart_count: '3',
        namespace: 'production',
      },
    });

    const oomTs = new Date(now.getTime() - 16 * 60_000);
    logs.push({
      timestamp: formatTimestamp(oomTs),
      level: 'ERROR',
      service: 'kernel',
      instance: 'node-worker-02',
      message:
        'OOM Killer 触发: 进程 java (PID: 12345) 被杀死, ' +
        '内存使用: 3.9GB, 内存限制: 4GB',
      metrics: {
        event_type: 'OOMKill',
        process: 'java',
        pid: '12345',
        memory_used: '3.9GB',
        memory_limit: '4GB',
        cgroup: '/kubepods/pod-order-service',
      },
    });
  }

  return logs;
}

function buildGenericLogs(now: Date, query: string, limit: number): LogEntry[] {
  const logs: LogEntry[] = [];
  const count = Math.min(limit, 10);
  const levels: Array<'ERROR' | 'WARN' | 'INFO'> = ['ERROR', 'WARN', 'INFO'];

  for (let i = 0; i < count; i++) {
    const ts = new Date(now.getTime() - i * 60_000);
    logs.push({
      timestamp: formatTimestamp(ts),
      level: levels[i % 3],
      service: 'generic-service',
      instance: `instance-${i}`,
      message: `日志消息 #${i}, 查询条件: ${query}`,
      metrics: {},
    });
  }

  return logs;
}

function buildMockLogs(region: string, logTopic: string, query: string, limit: number): LogEntry[] {
  const now = new Date();
  const safeTopic = logTopic.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  let logs: LogEntry[];

  switch (safeTopic) {
    case 'system-metrics':
      logs = buildSystemMetricsLogs(now, normalizedQuery, limit);
      break;
    case 'application-logs':
      logs = buildApplicationLogs(now, normalizedQuery, limit);
      break;
    case 'database-slow-query':
      logs = buildDatabaseSlowQueryLogs(now, normalizedQuery, limit);
      break;
    case 'system-events':
      logs = buildSystemEventsLogs(now, normalizedQuery, limit);
      break;
    default:
      logs = buildGenericLogs(now, normalizedQuery, limit);
  }

  if (logs.length === 0) {
    logs = buildGenericLogs(now, normalizedQuery, limit);
  }

  if (logs.length > limit) {
    logs = logs.slice(0, limit);
  }

  return logs;
}

// ---------------------------------------------------------------------------
// Tool: getAvailableLogTopics
// ---------------------------------------------------------------------------

/**
 * Creates the getAvailableLogTopics tool.
 * Returns available log topics, example queries, and related alerts.
 */
export function createGetAvailableLogTopicsTool() {
  return tool({
    description:
      'Get all available log topics and their descriptions. ' +
      'Call this tool first before querying logs to understand what log topics are available. ' +
      'Returns a list of log topics with their names, descriptions, and example queries.',
    parameters: z.object({}),
    execute: async (): Promise<LogTopicsOutput> => {
      logger.info('Executing getAvailableLogTopics tool');

      const topics: LogTopicInfo[] = [
        {
          topic_name: 'system-metrics',
          description: '系统指标日志，包含 CPU、内存、磁盘使用率等系统资源监控数据',
          example_queries: [
            'cpu_usage:>80',
            'memory_usage:>85',
            'disk_usage:>90',
            'level:WARN AND service:payment-service',
          ],
          related_alerts: ['HighCPUUsage', 'HighMemoryUsage', 'HighDiskUsage'],
        },
        {
          topic_name: 'application-logs',
          description: '应用日志，包含应用程序的错误日志、警告日志、慢请求日志、下游依赖调用日志等',
          example_queries: [
            'level:ERROR',
            'level:FATAL',
            'http_status:500',
            'response_time:>3000',
            'slow',
            'downstream OR redis OR database OR mq',
          ],
          related_alerts: ['ServiceUnavailable', 'SlowResponse', 'HighMemoryUsage'],
        },
        {
          topic_name: 'database-slow-query',
          description: '数据库慢查询日志，包含执行时间较长的 SQL 查询，可用于分析数据库性能问题',
          example_queries: [
            'query_time:>2',
            'table:orders',
            'query_type:SELECT',
            '*',
          ],
          related_alerts: ['SlowResponse', 'ServiceUnavailable'],
        },
        {
          topic_name: 'system-events',
          description: '系统事件日志，包含 Kubernetes Pod 重启、OOM Kill、容器崩溃等系统级事件',
          example_queries: [
            'restart OR crash',
            'oom_kill',
            'event_type:PodRestart',
            'reason:OOMKilled',
          ],
          related_alerts: ['ServiceUnavailable', 'HighMemoryUsage'],
        },
      ];

      return {
        success: true,
        topics,
        available_regions: [...VALID_REGIONS],
        default_region: DEFAULT_REGION,
        message: `共有 ${topics.length} 个可用的日志主题。建议使用默认地域 '${DEFAULT_REGION}' 或省略 region 参数`,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Tool: queryLogs
// ---------------------------------------------------------------------------

/**
 * Creates the queryLogs tool.
 * Currently mock-only; returns realistic simulated log data.
 *
 * @param config - Application config (reads cls.mockEnabled)
 */
export function createQueryLogsTool(config: AppConfig) {
  const { mockEnabled } = config.cls;

  return tool({
    description:
      'Query logs from Cloud Log Service (CLS). ' +
      'Use this tool to search application logs, system metrics, and other log data. ' +
      'IMPORTANT: Before calling this tool, you should call getAvailableLogTopics to understand what log topics are available. ' +
      'Available log topics: ' +
      "1) 'system-metrics' - System metrics logs (CPU, memory, disk usage, etc. Related to HighCPUUsage, HighMemoryUsage, HighDiskUsage alerts); " +
      "2) 'application-logs' - Application logs (error logs, slow request logs, downstream dependency logs. Related to ServiceUnavailable, SlowResponse alerts); " +
      "3) 'database-slow-query' - Database slow query logs (SQL queries with long execution time. Related to SlowResponse alerts); " +
      "4) 'system-events' - System event logs (Pod restart, OOM Kill, container crash. Related to ServiceUnavailable, HighMemoryUsage alerts). " +
      'logTopic (required, one of the above topics or their CLS topicId), ' +
      'query (optional, defaults to a curated search if empty), ' +
      'limit (optional, default 20, max 100).',
    parameters: z.object({
      region: z
        .string()
        .optional()
        .describe(
          `地域，可选值: ${VALID_REGIONS.join(', ')}。默认 ${DEFAULT_REGION}`,
        ),
      logTopic: z
        .string()
        .describe(
          '日志主题，如 system-metrics, application-logs, database-slow-query, system-events，也支持 CLS TopicId',
        ),
      query: z
        .string()
        .optional()
        .describe(
          '查询条件，支持 Lucene 语法，如 level:ERROR OR cpu_usage:>80；为空时返回该主题近 5 条核心日志',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('返回日志条数，默认20，最大100'),
    }),
    execute: async ({ region, logTopic, query, limit }): Promise<QueryLogsOutput> => {
      const actualLimit = limit && limit > 0 ? Math.min(limit, 100) : 20;
      const safeRegion = region ?? DEFAULT_REGION;
      const safeQuery = query ?? '';

      logger.info(
        { region: safeRegion, logTopic, query: safeQuery, limit: actualLimit, mockEnabled },
        'Executing queryLogs tool',
      );

      try {
        let logEntries: LogEntry[];

        if (mockEnabled) {
          logEntries = buildMockLogs(safeRegion, logTopic, safeQuery, actualLimit);
          logger.info({ count: logEntries.length }, 'Using mock log data');
        } else {
          // Real mode: CLS API not yet implemented
          return buildErrorResponse('CLS 真实查询尚未实现，请启用 mock 模式进行测试');
        }

        return {
          success: logEntries.length > 0,
          region: safeRegion,
          log_topic: logTopic,
          query: safeQuery === '' ? 'DEFAULT_QUERY' : safeQuery,
          logs: logEntries,
          total: logEntries.length,
          message:
            logEntries.length === 0
              ? '未找到匹配的日志'
              : `成功查询到 ${logEntries.length} 条日志`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'Failed to query logs');
        return buildErrorResponse(`查询失败: ${message}`);
      }
    },
  });
}
