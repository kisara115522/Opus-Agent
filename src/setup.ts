#!/usr/bin/env tsx
/**
 * SuperBiz Agent — Setup Wizard
 *
 * Interactive configuration wizard built on @clack/prompts.
 * Run: npm run setup / make setup
 */

import { writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import {
  validateApiKeyFormat,
  testProviderConnection,
  getDefaultModels,
  getDefaultEmbeddingModels,
} from './utils/provider-validator.js';
import { theme } from './setup/theme.js';

// ── Constants ────────────────────────────────────────────────────────────────

const ENV_PATH = resolve(import.meta.dirname, '..', '.env');

interface EnvConfig { [key: string]: string }

interface ProviderChoice {
  label: string; hint: string; value: string;
}

const LLM_PROVIDERS: ProviderChoice[] = [
  { label: 'OpenAI',    hint: 'GPT-4o, o1, o3',            value: 'openai' },
  { label: 'Anthropic', hint: 'Claude 4 Opus / Sonnet',    value: 'anthropic' },
  { label: 'DashScope', hint: 'Qwen-Max, 阿里云',           value: 'dashscope' },
  { label: '自定义',     hint: 'OpenAI Compatible API',     value: 'custom' },
];

const EMBEDDING_PROVIDERS: ProviderChoice[] = [
  { label: 'OpenAI',    hint: 'text-embedding-3-small',    value: 'openai' },
  { label: 'DashScope', hint: 'text-embedding-v2',         value: 'dashscope' },
];

const API_KEY_ENV_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  custom: 'CUSTOM_API_KEY',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function maskKey(key: string): string {
  if (!key || key.length < 10) return theme.muted('***');
  return theme.muted(key.slice(0, 6) + '...') + key.slice(-4);
}

function providerLabel(provider: string): string {
  const map: Record<string, string> = {
    openai: theme.accent('OpenAI'),
    anthropic: theme.accentBright('Anthropic'),
    dashscope: theme.info('DashScope'),
    custom: theme.warn('Custom'),
  };
  return map[provider] || provider;
}

function checkCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel(theme.muted('已取消配置。'));
    process.exit(0);
  }
  return value;
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function loadExistingEnv(): Promise<EnvConfig> {
  const config: EnvConfig = {};
  try {
    const content = await readFile(ENV_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        config[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
      }
    }
  } catch {}
  return config;
}

// ── Banner ───────────────────────────────────────────────────────────────────

function showBanner(): void {
  const art = [
    theme.accentBright('  ╔══════════════════════════════════════╗'),
    theme.accentBright('  ║') + theme.heading('   SuperBiz Agent  ') + theme.muted('v1.0') + theme.accentBright('             ║'),
    theme.accentBright('  ║') + theme.muted('   Enterprise Intelligent Ops Agent   ') + theme.accentBright('║'),
    theme.accentBright('  ╚══════════════════════════════════════╝'),
  ];
  console.log('');
  console.log(art.join('\n'));
  console.log('');
}

// ── Generate .env ────────────────────────────────────────────────────────────

function generateEnv(config: EnvConfig): string {
  const v = (key: string, fallback = '') => config[key] || fallback;
  const sections: string[][] = [
    ['# ─── 服务器 ───', `PORT=${v('PORT', '9900')}`],
    ['# ─── LLM 提供商 ───',
      `LLM_PROVIDER=${v('LLM_PROVIDER', 'openai')}`,
      `LLM_MODEL=${v('LLM_MODEL', 'gpt-4o')}`,
      `OPENAI_API_KEY=${v('OPENAI_API_KEY')}`,
      `ANTHROPIC_API_KEY=${v('ANTHROPIC_API_KEY')}`,
      `DASHSCOPE_API_KEY=${v('DASHSCOPE_API_KEY')}`,
      `CUSTOM_API_KEY=${v('CUSTOM_API_KEY')}`,
      `CUSTOM_LLM_ENDPOINT=${v('CUSTOM_LLM_ENDPOINT')}`,
    ],
    ['# ─── Embedding 提供商 ───',
      `EMBEDDING_PROVIDER=${v('EMBEDDING_PROVIDER', 'openai')}`,
      `EMBEDDING_MODEL=${v('EMBEDDING_MODEL', 'text-embedding-3-small')}`,
    ],
    ['# ─── Milvus (可选) ───',
      `MILVUS_HOST=${v('MILVUS_HOST', 'localhost')}`,
      `MILVUS_PORT=${v('MILVUS_PORT', '19530')}`,
      `MILVUS_USERNAME=${v('MILVUS_USERNAME')}`,
      `MILVUS_PASSWORD=${v('MILVUS_PASSWORD')}`,
      `MILVUS_DATABASE=${v('MILVUS_DATABASE', 'default')}`,
      `MILVUS_TIMEOUT=${v('MILVUS_TIMEOUT', '10000')}`,
    ],
    ['# ─── RAG ───',
      `RAG_TOP_K=${v('RAG_TOP_K', '3')}`,
      `RAG_MODEL=${v('RAG_MODEL', config.LLM_MODEL || 'gpt-4o')}`,
    ],
    ['# ─── Prometheus ───',
      `PROMETHEUS_BASE_URL=${v('PROMETHEUS_BASE_URL', 'http://localhost:9090')}`,
      `PROMETHEUS_TIMEOUT=${v('PROMETHEUS_TIMEOUT', '10')}`,
      `PROMETHEUS_MOCK_ENABLED=${v('PROMETHEUS_MOCK_ENABLED', 'false')}`,
    ],
    ['# ─── CLS 日志 ───',
      `CLS_MOCK_ENABLED=${v('CLS_MOCK_ENABLED', 'false')}`,
    ],
    ['# ─── Agent 防护 ───',
      `AGENT_GUARD_ENABLED=${v('AGENT_GUARD_ENABLED', 'true')}`,
      `AGENT_FAILURE_THRESHOLD=${v('AGENT_FAILURE_THRESHOLD', '3')}`,
      `AGENT_TOOL_CALL_LIMIT=${v('AGENT_TOOL_CALL_LIMIT', '12')}`,
      `AGENT_MODEL_CALL_LIMIT=${v('AGENT_MODEL_CALL_LIMIT', '25')}`,
    ],
    ['# ─── 发布预检 ───',
      `RELEASE_PRECHECK_ENABLED=${v('RELEASE_PRECHECK_ENABLED', 'true')}`,
      `RELEASE_PRECHECK_DEFAULT_TIMEOUT=${v('RELEASE_PRECHECK_DEFAULT_TIMEOUT', '900000')}`,
      `RELEASE_PRECHECK_HISTORY_FILE=${v('RELEASE_PRECHECK_HISTORY_FILE', './uploads/release-precheck-history.json')}`,
      `RELEASE_PRECHECK_WEIGHT_AUDIT_FILE=${v('RELEASE_PRECHECK_WEIGHT_AUDIT_FILE', './uploads/release-precheck-weight-audit.json')}`,
      `SCORE_WEIGHT_PRODUCTION=${v('SCORE_WEIGHT_PRODUCTION', '15')}`,
      `SCORE_WEIGHT_PEAK_WINDOW=${v('SCORE_WEIGHT_PEAK_WINDOW', '10')}`,
      `SCORE_WEIGHT_EMERGENCY=${v('SCORE_WEIGHT_EMERGENCY', '20')}`,
      `SCORE_WEIGHT_DATABASE_CHANGE=${v('SCORE_WEIGHT_DATABASE_CHANGE', '15')}`,
      `SCORE_WEIGHT_CONFIG_CHANGE=${v('SCORE_WEIGHT_CONFIG_CHANGE', '8')}`,
      `SCORE_WEIGHT_LARGE_CHANGE=${v('SCORE_WEIGHT_LARGE_CHANGE', '12')}`,
      `SCORE_WEIGHT_ACTIVE_ALERTS=${v('SCORE_WEIGHT_ACTIVE_ALERTS', '20')}`,
      `SCORE_WEIGHT_MISSING_RUNBOOK=${v('SCORE_WEIGHT_MISSING_RUNBOOK', '15')}`,
      `SCORE_WEIGHT_RECENT_INCIDENT=${v('SCORE_WEIGHT_RECENT_INCIDENT', '10')}`,
      `SCORE_WEIGHT_MISSING_DEPLOYMENT_HISTORY=${v('SCORE_WEIGHT_MISSING_DEPLOYMENT_HISTORY', '8')}`,
    ],
    ['# ─── 代码审查 ───',
      `CODE_REVIEW_ENABLED=${v('CODE_REVIEW_ENABLED', 'true')}`,
      `CODE_REVIEW_DEFAULT_TIMEOUT=${v('CODE_REVIEW_DEFAULT_TIMEOUT', '900000')}`,
      `CODE_REVIEW_COMMAND_TIMEOUT_SECONDS=${v('CODE_REVIEW_COMMAND_TIMEOUT_SECONDS', '20')}`,
      `CODE_REVIEW_HISTORY_FILE=${v('CODE_REVIEW_HISTORY_FILE', './uploads/code-review-history.json')}`,
      `CODE_REVIEW_MAX_COMMITS=${v('CODE_REVIEW_MAX_COMMITS', '30')}`,
      `CODE_REVIEW_MAX_FILES=${v('CODE_REVIEW_MAX_FILES', '200')}`,
      `CODE_REVIEW_MAX_PATCH_CHARS_PER_FILE=${v('CODE_REVIEW_MAX_PATCH_CHARS_PER_FILE', '12000')}`,
      `CODE_REVIEW_BLOCK_SCORE=${v('CODE_REVIEW_BLOCK_SCORE', '65')}`,
      `CODE_REVIEW_RAG_EVIDENCE_ENABLED=${v('CODE_REVIEW_RAG_EVIDENCE_ENABLED', 'true')}`,
      `CODE_REVIEW_RAG_QUERIES_PER_REVIEW=${v('CODE_REVIEW_RAG_QUERIES_PER_REVIEW', '3')}`,
      `CODE_REVIEW_AGENT_ENABLED=${v('CODE_REVIEW_AGENT_ENABLED', 'true')}`,
      `CODE_REVIEW_AGENT_MAX_FILES=${v('CODE_REVIEW_AGENT_MAX_FILES', '8')}`,
      `CODE_REVIEW_AGENT_MAX_PATCH_CHARS_PER_FILE=${v('CODE_REVIEW_AGENT_MAX_PATCH_CHARS_PER_FILE', '4000')}`,
      `CODE_REVIEW_REQUIRE_ALLOWED_ROOTS=${v('CODE_REVIEW_REQUIRE_ALLOWED_ROOTS', 'false')}`,
      `CODE_REVIEW_ALLOWED_ROOTS=${v('CODE_REVIEW_ALLOWED_ROOTS', '.')}`,
    ],
    ['# ─── 文档分片 ───',
      `DOCUMENT_CHUNK_MAX_SIZE=${v('DOCUMENT_CHUNK_MAX_SIZE', '800')}`,
      `DOCUMENT_CHUNK_OVERLAP=${v('DOCUMENT_CHUNK_OVERLAP', '100')}`,
    ],
    ['# ─── 文件上传 ───',
      `FILE_UPLOAD_PATH=${v('FILE_UPLOAD_PATH', './uploads')}`,
      `FILE_UPLOAD_ALLOWED_EXTENSIONS=${v('FILE_UPLOAD_ALLOWED_EXTENSIONS', 'txt,md')}`,
    ],
  ];

  const header = [
    '# ==============================================',
    '# SuperBiz Agent - 自动生成的配置',
    '# 运行 npm run setup 可重新配置',
    '# ==============================================',
    '',
  ];

  return header.join('\n') + sections.map(s => s.join('\n')).join('\n\n') + '\n';
}

// ── Wizard Steps ─────────────────────────────────────────────────────────────

async function stepServer(config: EnvConfig): Promise<void> {
  const port = checkCancel(await p.text({
    message: '服务端口:',
    defaultValue: config.PORT || '9900',
    placeholder: '9900',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return '端口必须是 1-65535 之间的整数';
    },
  }));
  config.PORT = port;
}

async function stepLLM(config: EnvConfig): Promise<void> {
  const provider = checkCancel(await p.select({
    message: '选择 LLM 提供商:',
    options: LLM_PROVIDERS.map(p => ({ value: p.value, label: p.label, hint: p.hint })),
    initialValue: config.LLM_PROVIDER || 'openai',
  }));
  config.LLM_PROVIDER = provider;

  // API Key
  const keyEnv = API_KEY_ENV_MAP[provider];
  const existingKey = config[keyEnv] || '';
  const hasValidKey = existingKey && existingKey !== 'sk-your-key-here';

  if (hasValidKey) {
    p.log.info(`当前 ${keyEnv}: ${maskKey(existingKey)}`);
    const keep = checkCancel(await p.confirm({
      message: '保留现有 API Key?',
      initialValue: true,
    }));
    if (!keep) {
      const newKey = checkCancel(await p.password({
        message: `输入 ${keyEnv}:`,
      }));
      if (newKey) config[keyEnv] = newKey;
    }
  } else {
    const newKey = checkCancel(await p.password({
      message: `输入 ${keyEnv}:`,
    }));
    if (newKey) config[keyEnv] = newKey;
  }

  // Validate key format
  const keyToValidate = config[keyEnv] || '';
  if (keyToValidate) {
    const validation = validateApiKeyFormat(provider, keyToValidate);
    if (validation.valid) {
      p.log.success('API Key 格式验证通过');
    } else {
      p.log.warn(validation.message);
    }

    // Test connection
    if (validation.valid && provider !== 'custom') {
      const testConn = checkCancel(await p.confirm({
        message: '测试 API 连接?',
        initialValue: true,
      }));
      if (testConn) {
        const s = p.spinner();
        s.start(`连接 ${providerLabel(provider)}...`);
        const result = await testProviderConnection(provider, keyToValidate);
        if (result.success) {
          s.stop(`${result.message}`);
        } else {
          s.stop(`连接失败: ${result.message}`);
          p.log.warn('API Key 可能无效，但你可以继续配置');
        }
      }
    }
  }

  // Model selection
  const models = getDefaultModels(provider);
  if (models.length > 0) {
    const model = checkCancel(await p.select({
      message: '选择 LLM 模型:',
      options: models.map(m => ({ value: m, label: m })),
      initialValue: config.LLM_MODEL || models[0],
    }));
    config.LLM_MODEL = model;
  }

  // Custom endpoint
  if (provider === 'custom') {
    const endpoint = checkCancel(await p.text({
      message: 'API Endpoint:',
      defaultValue: config.CUSTOM_LLM_ENDPOINT || 'https://api.example.com/v1',
      placeholder: 'https://api.example.com/v1',
    }));
    config.CUSTOM_LLM_ENDPOINT = endpoint;
  }
}

async function stepEmbedding(config: EnvConfig): Promise<void> {
  const llmProvider = config.LLM_PROVIDER;
  const canReuse = llmProvider === 'openai' || llmProvider === 'dashscope';

  if (canReuse) {
    const reuse = checkCancel(await p.confirm({
      message: `使用 ${providerLabel(llmProvider)} 作为 Embedding 提供商?`,
      initialValue: true,
    }));
    if (reuse) {
      config.EMBEDDING_PROVIDER = llmProvider;
      const models = getDefaultEmbeddingModels(llmProvider);
      if (models.length > 0) {
        const model = checkCancel(await p.select({
          message: '选择 Embedding 模型:',
          options: models.map(m => ({ value: m, label: m })),
          initialValue: config.EMBEDDING_MODEL || models[0],
        }));
        config.EMBEDDING_MODEL = model;
      }
      p.log.success('复用 LLM API Key');
      return;
    }
  }

  const provider = checkCancel(await p.select({
    message: '选择 Embedding 提供商:',
    options: EMBEDDING_PROVIDERS.map(p => ({ value: p.value, label: p.label, hint: p.hint })),
  }));
  config.EMBEDDING_PROVIDER = provider;

  const keyEnv = API_KEY_ENV_MAP[provider];
  if (!config[keyEnv]) {
    const newKey = checkCancel(await p.password({
      message: `输入 ${keyEnv}:`,
    }));
    if (newKey) config[keyEnv] = newKey;
  }

  const models = getDefaultEmbeddingModels(provider);
  if (models.length > 0) {
    const model = checkCancel(await p.select({
      message: '选择 Embedding 模型:',
      options: models.map(m => ({ value: m, label: m })),
      initialValue: config.EMBEDDING_MODEL || models[0],
    }));
    config.EMBEDDING_MODEL = model;
  }
}

async function stepMilvus(config: EnvConfig): Promise<void> {
  p.log.message(theme.muted('Milvus 用于知识库 RAG 检索。不配置时其他功能正常工作。'));

  const enable = checkCancel(await p.confirm({
    message: '是否配置 Milvus?',
    initialValue: false,
  }));

  if (!enable) {
    p.log.info('已跳过 — 知识库功能将不可用');
    return;
  }

  const host = checkCancel(await p.text({
    message: 'Milvus 主机:',
    defaultValue: config.MILVUS_HOST || 'localhost',
    placeholder: 'localhost',
  }));
  config.MILVUS_HOST = host;

  const port = checkCancel(await p.text({
    message: 'Milvus 端口:',
    defaultValue: config.MILVUS_PORT || '19530',
    placeholder: '19530',
  }));
  config.MILVUS_PORT = port;

  const auth = checkCancel(await p.confirm({
    message: '是否需要认证?',
    initialValue: false,
  }));

  if (auth) {
    const username = checkCancel(await p.text({
      message: '用户名:',
      defaultValue: config.MILVUS_USERNAME || '',
    }));
    config.MILVUS_USERNAME = username;

    const password = checkCancel(await p.password({
      message: '密码:',
    }));
    if (password) config.MILVUS_PASSWORD = password;
  }

  // Test connection
  const s = p.spinner();
  s.start('测试 Milvus 连接...');
  try {
    const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
    const client = new MilvusClient({
      address: `${config.MILVUS_HOST}:${config.MILVUS_PORT}`,
      username: config.MILVUS_USERNAME || undefined,
      password: config.MILVUS_PASSWORD || undefined,
      timeout: 5000,
    });
    await client.checkHealth();
    await client.closeConnection();
    s.stop('Milvus 连接成功');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    s.stop(`Milvus 连接失败: ${message}`);
    p.log.warn('你可以在 .env 中稍后配置 Milvus');
  }
}

async function stepOptional(config: EnvConfig): Promise<void> {
  const configure = checkCancel(await p.confirm({
    message: '配置 Prometheus / 日志等可选服务?',
    initialValue: false,
  }));

  if (!configure) {
    p.log.info('已跳过');
    return;
  }

  const promUrl = checkCancel(await p.text({
    message: 'Prometheus 地址:',
    defaultValue: config.PROMETHEUS_BASE_URL || 'http://localhost:9090',
    placeholder: 'http://localhost:9090',
  }));
  config.PROMETHEUS_BASE_URL = promUrl;

  const promMock = checkCancel(await p.confirm({
    message: '启用 Prometheus Mock 模式?',
    initialValue: false,
  }));
  config.PROMETHEUS_MOCK_ENABLED = String(promMock);

  const clsMock = checkCancel(await p.confirm({
    message: '启用日志 Mock 模式?',
    initialValue: false,
  }));
  config.CLS_MOCK_ENABLED = String(clsMock);
}

async function stepGuard(config: EnvConfig): Promise<void> {
  p.log.message(theme.muted('防止 Agent 工具调用失控的保护机制'));

  const enabled = checkCancel(await p.confirm({
    message: '启用 Agent 防护?',
    initialValue: true,
  }));
  config.AGENT_GUARD_ENABLED = String(enabled);

  if (enabled) {
    const threshold = checkCancel(await p.text({
      message: '连续失败阈值 (触发熔断):',
      defaultValue: config.AGENT_FAILURE_THRESHOLD || '3',
      placeholder: '3',
    }));
    config.AGENT_FAILURE_THRESHOLD = threshold;

    const toolLimit = checkCancel(await p.text({
      message: '最大工具调用次数:',
      defaultValue: config.AGENT_TOOL_CALL_LIMIT || '12',
      placeholder: '12',
    }));
    config.AGENT_TOOL_CALL_LIMIT = toolLimit;

    const modelLimit = checkCancel(await p.text({
      message: '最大模型调用次数:',
      defaultValue: config.AGENT_MODEL_CALL_LIMIT || '25',
      placeholder: '25',
    }));
    config.AGENT_MODEL_CALL_LIMIT = modelLimit;
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

function showSummary(config: EnvConfig): void {
  const milvusStatus = config.MILVUS_HOST && config.MILVUS_HOST !== 'localhost'
    ? theme.success('已配置')
    : theme.muted('未配置');

  const lines = [
    `${chalk.bold('服务端口:')}      ${config.PORT || '9900'}`,
    '',
    `${chalk.bold('LLM 提供商:')}    ${providerLabel(config.LLM_PROVIDER || 'openai')}`,
    `${chalk.bold('LLM 模型:')}      ${config.LLM_MODEL || 'gpt-4o'}`,
    `${chalk.bold('API Key:')}       ${maskKey(config[API_KEY_ENV_MAP[config.LLM_PROVIDER || 'openai']] || '')}`,
    '',
    `${chalk.bold('Embedding:')}     ${providerLabel(config.EMBEDDING_PROVIDER || 'openai')} / ${config.EMBEDDING_MODEL || 'text-embedding-3-small'}`,
    '',
    `${chalk.bold('Milvus:')}        ${milvusStatus}`,
    `${chalk.bold('Agent 防护:')}    ${config.AGENT_GUARD_ENABLED === 'true' ? theme.success('已启用') : theme.muted('已禁用')}`,
  ];

  p.note(lines.join('\n'), '配置摘要');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  showBanner();

  const config = await loadExistingEnv();
  const hasExisting = Object.keys(config).length > 0;

  if (hasExisting) {
    p.log.success('检测到已有 .env 配置，将使用现有值作为默认值。');
    const action = checkCancel(await p.select({
      message: '已有配置，如何处理?',
      options: [
        { value: 'update', label: '更新配置', hint: '修改部分设置' },
        { value: 'keep',   label: '保持不变', hint: '跳过配置' },
        { value: 'reset',  label: '重新配置', hint: '从头开始' },
      ],
    }));

    if (action === 'keep') {
      p.log.info('保持现有配置不变。');
      p.outro(theme.muted('退出配置向导。'));
      return;
    }
    if (action === 'reset') {
      for (const key of Object.keys(config)) delete config[key];
    }
  }

  // Setup mode
  const mode = checkCancel(await p.select({
    message: '选择配置模式:',
    options: [
      { value: 'quick',   label: 'QuickStart', hint: '仅配置 LLM，其余使用默认值' },
      { value: 'manual',  label: 'Manual',     hint: '逐步配置所有选项' },
    ],
  }));

  // QuickStart only needs LLM
  await stepLLM(config);

  if (mode === 'manual') {
    await stepServer(config);
    await stepEmbedding(config);
    await stepMilvus(config);
    await stepOptional(config);
    await stepGuard(config);
  } else {
    // QuickStart defaults
    if (!config.EMBEDDING_PROVIDER) config.EMBEDDING_PROVIDER = config.LLM_PROVIDER || 'openai';
    const embModels = getDefaultEmbeddingModels(config.EMBEDDING_PROVIDER);
    if (!config.EMBEDDING_MODEL && embModels.length > 0) config.EMBEDDING_MODEL = embModels[0];
  }

  // Summary
  showSummary(config);

  // Confirm
  const confirm = checkCancel(await p.confirm({
    message: '确认写入 .env 文件?',
    initialValue: true,
  }));

  if (!confirm) {
    p.cancel(theme.muted('已取消，未写入任何文件。'));
    return;
  }

  // Write .env
  const s = p.spinner();
  s.start('写入 .env 文件...');
  try {
    await writeFile(ENV_PATH, generateEnv(config), 'utf-8');
    s.stop('.env 文件已生成');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    s.stop(`写入失败: ${message}`);
    process.exit(1);
  }

  // Next steps
  const nextSteps = [
    `${theme.command('npm run dev')}              启动开发服务器`,
    `${theme.command('make test')}                运行测试`,
    `${theme.command('docker compose up -d')}     启动 Milvus`,
    '',
    `打开浏览器: ${theme.command(`http://localhost:${config.PORT || '9900'}`)}`,
  ];
  p.note(nextSteps.join('\n'), '下一步');

  p.outro(theme.success('配置完成!'));
}

main().catch((err) => {
  console.error(chalk.red(`\nSetup failed: ${err.message}\n`));
  process.exit(1);
});
