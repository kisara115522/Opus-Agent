#!/usr/bin/env tsx
/**
 * SuperBiz Agent - Professional Setup Wizard
 *
 * Interactive CLI configuration tool with provider validation,
 * connection testing, and polished terminal UI.
 *
 * Run: npm run setup
 * Or:  make setup
 */

import { writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  color,
  box,
  createSpinner,
  showBanner,
  step,
  promptInput,
  promptSelect,
  promptConfirm,
  promptPassword,
} from './utils/terminal.js';
import {
  validateApiKeyFormat,
  testProviderConnection,
  getDefaultModels,
  getDefaultEmbeddingModels,
} from './utils/provider-validator.js';

const ENV_PATH = resolve(import.meta.dirname, '..', '.env');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnvConfig {
  [key: string]: string;
}

interface ProviderChoice {
  label: string;
  description: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LLM_PROVIDERS: ProviderChoice[] = [
  {
    label: 'OpenAI',
    description: 'GPT-4o, GPT-4o-mini, o1, o3 — 全球最流行的 LLM 提供商',
    value: 'openai',
  },
  {
    label: 'Anthropic',
    description: 'Claude 4 Opus, Sonnet, Haiku — 长上下文、强推理能力',
    value: 'anthropic',
  },
  {
    label: 'DashScope (阿里云)',
    description: 'Qwen-Max, Qwen-Plus, Qwen-Turbo — 国内首选，低延迟',
    value: 'dashscope',
  },
  {
    label: '自定义 (OpenAI Compatible)',
    description: '支持任何 OpenAI API 兼容的提供商 (如 DeepSeek, Moonshot)',
    value: 'custom',
  },
];

const EMBEDDING_PROVIDERS: ProviderChoice[] = [
  {
    label: 'OpenAI',
    description: 'text-embedding-3-small/large — 业界标准',
    value: 'openai',
  },
  {
    label: 'DashScope (阿里云)',
    description: 'text-embedding-v2 — 国内低延迟',
    value: 'dashscope',
  },
];

const API_KEY_ENV_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  dashscope: 'DASHSCOPE_API_KEY',
  custom: 'CUSTOM_API_KEY',
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        config[key] = value;
      }
    }
  } catch {}
  return config;
}

function maskKey(key: string): string {
  if (!key || key.length < 10) return color.dim('***');
  return color.dim(key.slice(0, 6) + '...') + key.slice(-4);
}

function formatProvider(provider: string): string {
  const map: Record<string, string> = {
    openai: color.green('OpenAI'),
    anthropic: color.magenta('Anthropic'),
    dashscope: color.cyan('DashScope'),
    custom: color.yellow('Custom'),
  };
  return map[provider] || provider;
}

// ---------------------------------------------------------------------------
// Setup Steps
// ---------------------------------------------------------------------------

async function stepServer(rl: any, config: EnvConfig): Promise<void> {
  step(1, 6, '服务器配置');
  console.log('');

  config.PORT = await promptInput('服务端口', config.PORT || '9900');
  console.log('');
}

async function stepLLM(rl: any, config: EnvConfig): Promise<void> {
  step(2, 6, 'LLM 提供商');
  console.log('');

  // Provider selection
  const currentProvider = config.LLM_PROVIDER || 'openai';
  const provider = await promptSelect('选择 LLM 提供商:', LLM_PROVIDERS);
  config.LLM_PROVIDER = provider;

  // API Key
  const keyEnv = API_KEY_ENV_MAP[provider];
  const existingKey = config[keyEnv] || '';
  const hasValidKey = existingKey && existingKey !== 'sk-your-key-here';

  if (hasValidKey) {
    console.log(`  当前 ${keyEnv}: ${maskKey(existingKey)}`);
    const keepKey = await promptConfirm('保留现有 API Key?', true);
    if (!keepKey) {
      const newKey = await promptPassword(`输入 ${keyEnv}`);
      if (newKey) config[keyEnv] = newKey;
    }
  } else {
    const newKey = await promptPassword(`输入 ${keyEnv}`);
    if (newKey) config[keyEnv] = newKey;
  }

  // Validate key format
  const keyToValidate = config[keyEnv] || '';
  if (keyToValidate) {
    const validation = validateApiKeyFormat(provider, keyToValidate);
    if (validation.valid) {
      console.log(`  ${color.success('API Key 格式验证通过')}`);
    } else {
      console.log(`  ${color.warning(validation.message)}`);
    }
  }

  // Model selection
  const models = getDefaultModels(provider);
  const currentModel = config.LLM_MODEL || models[0];
  config.LLM_MODEL = await promptSelect('选择 LLM 模型:',
    models.map(m => ({ label: m, value: m, description: '' }))
  );

  // Custom endpoint for custom provider
  if (provider === 'custom') {
    config.CUSTOM_LLM_ENDPOINT = await promptInput(
      'API Endpoint',
      config.CUSTOM_LLM_ENDPOINT || 'https://api.example.com/v1'
    );
  }

  console.log('');
}

async function stepEmbedding(rl: any, config: EnvConfig): Promise<void> {
  step(3, 6, 'Embedding 提供商');
  console.log('');

  const llmProvider = config.LLM_PROVIDER;
  const canReuse = llmProvider === 'openai' || llmProvider === 'dashscope';

  if (canReuse) {
    const reuse = await promptConfirm(`使用 ${formatProvider(llmProvider)} 作为 Embedding 提供商?`, true);
    if (reuse) {
      config.EMBEDDING_PROVIDER = llmProvider;
      const models = getDefaultEmbeddingModels(llmProvider);
      config.EMBEDDING_MODEL = await promptSelect('选择 Embedding 模型:',
        models.map(m => ({ label: m, value: m, description: '' }))
      );
      console.log(`  ${color.success('复用 LLM API Key')}`);
      console.log('');
      return;
    }
  }

  const provider = await promptSelect('选择 Embedding 提供商:', EMBEDDING_PROVIDERS);
  config.EMBEDDING_PROVIDER = provider;

  const keyEnv = API_KEY_ENV_MAP[provider];
  if (!config[keyEnv]) {
    const newKey = await promptPassword(`输入 ${keyEnv}`);
    if (newKey) config[keyEnv] = newKey;
  }

  const models = getDefaultEmbeddingModels(provider);
  config.EMBEDDING_MODEL = await promptSelect('选择 Embedding 模型:',
    models.map(m => ({ label: m, value: m, description: '' }))
  );

  console.log('');
}

async function stepMilvus(rl: any, config: EnvConfig): Promise<void> {
  step(4, 6, '向量数据库 (Milvus)');
  console.log('');
  console.log(`  ${color.dim('Milvus 用于知识库 RAG 检索。不配置时其他功能正常工作。')}`);
  console.log('');

  const enable = await promptConfirm('是否配置 Milvus?', false);
  if (!enable) {
    console.log(`  ${color.dim('已跳过 — 知识库功能将不可用')}`);
    console.log('');
    return;
  }

  config.MILVUS_HOST = await promptInput('Milvus 主机', config.MILVUS_HOST || 'localhost');
  config.MILVUS_PORT = await promptInput('Milvus 端口', config.MILVUS_PORT || '19530');

  const auth = await promptConfirm('是否需要认证?', false);
  if (auth) {
    config.MILVUS_USERNAME = await promptInput('用户名', config.MILVUS_USERNAME || '');
    config.MILVUS_PASSWORD = await promptPassword('密码');
  }

  // Test connection
  const spinner = createSpinner('测试 Milvus 连接...');
  spinner.start();
  try {
    // Simple check - try to connect
    const { MilvusClient } = await import('@zilliz/milvus2-sdk-node');
    const client = new MilvusClient({
      address: `${config.MILVUS_HOST}:${config.MILVUS_PORT}`,
      username: config.MILVUS_USERNAME || undefined,
      password: config.MILVUS_PASSWORD || undefined,
      timeout: 5000,
    });
    await client.checkHealth();
    await client.closeConnection();
    spinner.success('Milvus 连接成功');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.error(`Milvus 连接失败: ${message}`);
    console.log(`  ${color.dim('你可以在 .env 中稍后配置 Milvus')}`);
  }

  console.log('');
}

async function stepOptional(rl: any, config: EnvConfig): Promise<void> {
  step(5, 6, '可选服务');
  console.log('');

  const configure = await promptConfirm('配置 Prometheus / 日志等可选服务?', false);
  if (!configure) {
    console.log(`  ${color.dim('已跳过')}`);
    console.log('');
    return;
  }

  // Prometheus
  config.PROMETHEUS_BASE_URL = await promptInput(
    'Prometheus 地址',
    config.PROMETHEUS_BASE_URL || 'http://localhost:9090'
  );
  config.PROMETHEUS_MOCK_ENABLED = await promptConfirm('启用 Prometheus Mock 模式?', false)
    .then(v => v ? 'true' : 'false');

  // CLS
  config.CLS_MOCK_ENABLED = await promptConfirm('启用日志 Mock 模式?', false)
    .then(v => v ? 'true' : 'false');

  console.log('');
}

async function stepGuard(rl: any, config: EnvConfig): Promise<void> {
  step(6, 6, 'Agent 防护设置');
  console.log('');
  console.log(`  ${color.dim('防止 Agent 工具调用失控的保护机制')}`);
  console.log('');

  config.AGENT_GUARD_ENABLED = await promptConfirm('启用 Agent 防护?', true)
    .then(v => v ? 'true' : 'false');

  if (config.AGENT_GUARD_ENABLED === 'true') {
    config.AGENT_FAILURE_THRESHOLD = await promptInput(
      '连续失败阈值 (触发熔断)',
      config.AGENT_FAILURE_THRESHOLD || '3'
    );
    config.AGENT_TOOL_CALL_LIMIT = await promptInput(
      '最大工具调用次数',
      config.AGENT_TOOL_CALL_LIMIT || '12'
    );
    config.AGENT_MODEL_CALL_LIMIT = await promptInput(
      '最大模型调用次数',
      config.AGENT_MODEL_CALL_LIMIT || '25'
    );
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Generate .env
// ---------------------------------------------------------------------------

function generateEnv(config: EnvConfig): string {
  const lines: string[] = [
    '# ==============================================',
    '# SuperBiz Agent - 自动生成的配置',
    '# 运行 npm run setup 可重新配置',
    '# ==============================================',
    '',
    '# ─── 服务器 ───',
    `PORT=${config.PORT || '9900'}`,
    '',
    '# ─── LLM 提供商 ───',
    `LLM_PROVIDER=${config.LLM_PROVIDER || 'openai'}`,
    `LLM_MODEL=${config.LLM_MODEL || 'gpt-4o'}`,
    `OPENAI_API_KEY=${config.OPENAI_API_KEY || ''}`,
    `ANTHROPIC_API_KEY=${config.ANTHROPIC_API_KEY || ''}`,
    `DASHSCOPE_API_KEY=${config.DASHSCOPE_API_KEY || ''}`,
    `CUSTOM_API_KEY=${config.CUSTOM_API_KEY || ''}`,
    `CUSTOM_LLM_ENDPOINT=${config.CUSTOM_LLM_ENDPOINT || ''}`,
    '',
    '# ─── Embedding 提供商 ───',
    `EMBEDDING_PROVIDER=${config.EMBEDDING_PROVIDER || 'openai'}`,
    `EMBEDDING_MODEL=${config.EMBEDDING_MODEL || 'text-embedding-3-small'}`,
    '',
    '# ─── Milvus (可选) ───',
    `MILVUS_HOST=${config.MILVUS_HOST || 'localhost'}`,
    `MILVUS_PORT=${config.MILVUS_PORT || '19530'}`,
    `MILVUS_USERNAME=${config.MILVUS_USERNAME || ''}`,
    `MILVUS_PASSWORD=${config.MILVUS_PASSWORD || ''}`,
    `MILVUS_DATABASE=${config.MILVUS_DATABASE || 'default'}`,
    `MILVUS_TIMEOUT=${config.MILVUS_TIMEOUT || '10000'}`,
    '',
    '# ─── RAG ───',
    `RAG_TOP_K=${config.RAG_TOP_K || '3'}`,
    `RAG_MODEL=${config.RAG_MODEL || config.LLM_MODEL || 'gpt-4o'}`,
    '',
    '# ─── Prometheus ───',
    `PROMETHEUS_BASE_URL=${config.PROMETHEUS_BASE_URL || 'http://localhost:9090'}`,
    `PROMETHEUS_TIMEOUT=${config.PROMETHEUS_TIMEOUT || '10'}`,
    `PROMETHEUS_MOCK_ENABLED=${config.PROMETHEUS_MOCK_ENABLED || 'false'}`,
    '',
    '# ─── CLS 日志 ───',
    `CLS_MOCK_ENABLED=${config.CLS_MOCK_ENABLED || 'false'}`,
    '',
    '# ─── Agent 防护 ───',
    `AGENT_GUARD_ENABLED=${config.AGENT_GUARD_ENABLED || 'true'}`,
    `AGENT_FAILURE_THRESHOLD=${config.AGENT_FAILURE_THRESHOLD || '3'}`,
    `AGENT_TOOL_CALL_LIMIT=${config.AGENT_TOOL_CALL_LIMIT || '12'}`,
    `AGENT_MODEL_CALL_LIMIT=${config.AGENT_MODEL_CALL_LIMIT || '25'}`,
    '',
    '# ─── 发布预检 ───',
    `RELEASE_PRECHECK_ENABLED=${config.RELEASE_PRECHECK_ENABLED || 'true'}`,
    `RELEASE_PRECHECK_DEFAULT_TIMEOUT=${config.RELEASE_PRECHECK_DEFAULT_TIMEOUT || '900000'}`,
    `RELEASE_PRECHECK_HISTORY_FILE=${config.RELEASE_PRECHECK_HISTORY_FILE || './uploads/release-precheck-history.json'}`,
    `RELEASE_PRECHECK_WEIGHT_AUDIT_FILE=${config.RELEASE_PRECHECK_WEIGHT_AUDIT_FILE || './uploads/release-precheck-weight-audit.json'}`,
    `SCORE_WEIGHT_PRODUCTION=${config.SCORE_WEIGHT_PRODUCTION || '15'}`,
    `SCORE_WEIGHT_PEAK_WINDOW=${config.SCORE_WEIGHT_PEAK_WINDOW || '10'}`,
    `SCORE_WEIGHT_EMERGENCY=${config.SCORE_WEIGHT_EMERGENCY || '20'}`,
    `SCORE_WEIGHT_DATABASE_CHANGE=${config.SCORE_WEIGHT_DATABASE_CHANGE || '15'}`,
    `SCORE_WEIGHT_CONFIG_CHANGE=${config.SCORE_WEIGHT_CONFIG_CHANGE || '8'}`,
    `SCORE_WEIGHT_LARGE_CHANGE=${config.SCORE_WEIGHT_LARGE_CHANGE || '12'}`,
    `SCORE_WEIGHT_ACTIVE_ALERTS=${config.SCORE_WEIGHT_ACTIVE_ALERTS || '20'}`,
    `SCORE_WEIGHT_MISSING_RUNBOOK=${config.SCORE_WEIGHT_MISSING_RUNBOOK || '15'}`,
    `SCORE_WEIGHT_RECENT_INCIDENT=${config.SCORE_WEIGHT_RECENT_INCIDENT || '10'}`,
    `SCORE_WEIGHT_MISSING_DEPLOYMENT_HISTORY=${config.SCORE_WEIGHT_MISSING_DEPLOYMENT_HISTORY || '8'}`,
    '',
    '# ─── 代码审查 ───',
    `CODE_REVIEW_ENABLED=${config.CODE_REVIEW_ENABLED || 'true'}`,
    `CODE_REVIEW_DEFAULT_TIMEOUT=${config.CODE_REVIEW_DEFAULT_TIMEOUT || '900000'}`,
    `CODE_REVIEW_COMMAND_TIMEOUT_SECONDS=${config.CODE_REVIEW_COMMAND_TIMEOUT_SECONDS || '20'}`,
    `CODE_REVIEW_HISTORY_FILE=${config.CODE_REVIEW_HISTORY_FILE || './uploads/code-review-history.json'}`,
    `CODE_REVIEW_MAX_COMMITS=${config.CODE_REVIEW_MAX_COMMITS || '30'}`,
    `CODE_REVIEW_MAX_FILES=${config.CODE_REVIEW_MAX_FILES || '200'}`,
    `CODE_REVIEW_MAX_PATCH_CHARS_PER_FILE=${config.CODE_REVIEW_MAX_PATCH_CHARS_PER_FILE || '12000'}`,
    `CODE_REVIEW_BLOCK_SCORE=${config.CODE_REVIEW_BLOCK_SCORE || '65'}`,
    `CODE_REVIEW_RAG_EVIDENCE_ENABLED=${config.CODE_REVIEW_RAG_EVIDENCE_ENABLED || 'true'}`,
    `CODE_REVIEW_RAG_QUERIES_PER_REVIEW=${config.CODE_REVIEW_RAG_QUERIES_PER_REVIEW || '3'}`,
    `CODE_REVIEW_AGENT_ENABLED=${config.CODE_REVIEW_AGENT_ENABLED || 'true'}`,
    `CODE_REVIEW_AGENT_MAX_FILES=${config.CODE_REVIEW_AGENT_MAX_FILES || '8'}`,
    `CODE_REVIEW_AGENT_MAX_PATCH_CHARS_PER_FILE=${config.CODE_REVIEW_AGENT_MAX_PATCH_CHARS_PER_FILE || '4000'}`,
    `CODE_REVIEW_REQUIRE_ALLOWED_ROOTS=${config.CODE_REVIEW_REQUIRE_ALLOWED_ROOTS || 'false'}`,
    `CODE_REVIEW_ALLOWED_ROOTS=${config.CODE_REVIEW_ALLOWED_ROOTS || '.'}`,
    '',
    '# ─── 文档分片 ───',
    `DOCUMENT_CHUNK_MAX_SIZE=${config.DOCUMENT_CHUNK_MAX_SIZE || '800'}`,
    `DOCUMENT_CHUNK_OVERLAP=${config.DOCUMENT_CHUNK_OVERLAP || '100'}`,
    '',
    '# ─── 文件上传 ───',
    `FILE_UPLOAD_PATH=${config.FILE_UPLOAD_PATH || './uploads'}`,
    `FILE_UPLOAD_ALLOWED_EXTENSIONS=${config.FILE_UPLOAD_ALLOWED_EXTENSIONS || 'txt,md'}`,
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function showSummary(config: EnvConfig): void {
  const milvusStatus = config.MILVUS_HOST && config.MILVUS_HOST !== 'localhost'
    ? color.green('已配置')
    : color.dim('未配置');

  console.log(box(
    [
      '',
      `  ${color.bold('服务端口:')}      ${config.PORT || '9900'}`,
      '',
      `  ${color.bold('LLM 提供商:')}    ${formatProvider(config.LLM_PROVIDER || 'openai')}`,
      `  ${color.bold('LLM 模型:')}      ${config.LLM_MODEL || 'gpt-4o'}`,
      `  ${color.bold('API Key:')}       ${maskKey(config[API_KEY_ENV_MAP[config.LLM_PROVIDER || 'openai']] || '')}`,
      '',
      `  ${color.bold('Embedding:')}     ${formatProvider(config.EMBEDDING_PROVIDER || 'openai')} / ${config.EMBEDDING_MODEL || 'text-embedding-3-small'}`,
      '',
      `  ${color.bold('Milvus:')}        ${milvusStatus}`,
      `  ${color.bold('Agent 防护:')}    ${config.AGENT_GUARD_ENABLED === 'true' ? color.green('已启用') : color.dim('已禁用')}`,
      '',
    ].join('\n'),
    { title: '配置摘要', padding: 1 }
  ));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  showBanner('SuperBiz Agent', '企业级智能运维 Agent 系统 — 交互式配置向导');

  // Load existing config
  const config = await loadExistingEnv();
  const hasExisting = Object.keys(config).length > 0;

  if (hasExisting) {
    console.log(`  ${color.success('检测到已有 .env 配置')}，将使用现有值作为默认值。`);
    const reconfigure = await promptConfirm('是否重新配置?', false);
    if (!reconfigure) {
      console.log(`\n  ${color.dim('保持现有配置不变。')}\n`);
      return;
    }
    console.log('');
  }

  // Run setup steps
  await stepServer(null, config);
  await stepLLM(null, config);
  await stepEmbedding(null, config);
  await stepMilvus(null, config);
  await stepOptional(null, config);
  await stepGuard(null, config);

  // Summary
  showSummary(config);

  // Confirm
  const confirm = await promptConfirm('确认写入 .env 文件?', true);
  if (!confirm) {
    console.log(`\n  ${color.dim('已取消，未写入任何文件。')}\n`);
    return;
  }

  // Write .env
  const spinner = createSpinner('写入 .env 文件...');
  spinner.start();

  try {
    const content = generateEnv(config);
    await writeFile(ENV_PATH, content, 'utf-8');
    spinner.success('.env 文件已生成');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.error(`写入失败: ${message}`);
    process.exit(1);
  }

  // Success message
  console.log('');
  console.log(box(
    [
      '',
      `  ${color.bold(color.green('✅ 配置完成!'))}`,
      '',
      `  ${color.bold('下一步:')}`,
      '',
      `    ${color.cyan('npm run dev')}     启动开发服务器`,
      `    ${color.cyan('make test')}       运行测试`,
      `    ${color.cyan('docker compose up -d')}  启动 Milvus`,
      '',
      `  ${color.dim('打开浏览器:')} ${color.cyan(`http://localhost:${config.PORT || '9900'}`)}`,
      '',
    ].join('\n'),
    { title: '🎉 完成', padding: 1 }
  ));
}

main().catch((err) => {
  console.error(color.red(`\nSetup failed: ${err.message}\n`));
  process.exit(1);
});
