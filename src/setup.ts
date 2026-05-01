#!/usr/bin/env tsx
/**
 * Interactive CLI Setup - configure the application from terminal
 *
 * Run: npm run setup
 * Or:  npx tsx src/setup.ts
 */

import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const ENV_PATH = resolve(import.meta.dirname, '..', '.env');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EnvConfig {
  [key: string]: string;
}

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
  if (!key || key.length < 8) return '***';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

async function prompt(rl: readline.Interface, question: string, defaultVal: string): Promise<string> {
  const display = defaultVal ? ` (${defaultVal})` : '';
  const answer = await rl.question(`  ${question}${display}: `);
  return answer.trim() || defaultVal;
}

async function promptChoice(rl: readline.Interface, question: string, choices: string[], defaultVal: string): Promise<string> {
  console.log(`  ${question}`);
  choices.forEach((c, i) => {
    const marker = c === defaultVal ? '●' : '○';
    console.log(`    ${marker} ${i + 1}. ${c}`);
  });
  const answer = await rl.question(`  选择 (1-${choices.length}, 默认 ${defaultVal}): `);
  const idx = parseInt(answer, 10);
  if (idx >= 1 && idx <= choices.length) return choices[idx - 1];
  return defaultVal;
}

async function promptConfirm(rl: readline.Interface, question: string, defaultVal: boolean): Promise<boolean> {
  const hint = defaultVal ? 'Y/n' : 'y/N';
  const answer = await rl.question(`  ${question} (${hint}): `);
  if (!answer) return defaultVal;
  return answer.toLowerCase().startsWith('y');
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function setupLLM(rl: readline.Interface, config: EnvConfig): Promise<void> {
  console.log('\n━━━ LLM 配置 ━━━');

  const provider = await promptChoice(rl, '选择 LLM 提供商:', ['openai', 'anthropic', 'dashscope'], config.LLM_PROVIDER || 'openai');
  config.LLM_PROVIDER = provider;

  const modelDefaults: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-20250514',
    dashscope: 'qwen-max',
  };
  config.LLM_MODEL = await prompt(rl, 'LLM 模型', config.LLM_MODEL || modelDefaults[provider]);

  const keyEnvMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    dashscope: 'DASHSCOPE_API_KEY',
  };
  const keyName = keyEnvMap[provider];
  const existingKey = config[keyName] || '';
  const displayKey = existingKey && existingKey !== 'sk-your-key-here' ? maskKey(existingKey) : '(未设置)';
  console.log(`  当前 ${keyName}: ${displayKey}`);
  const newKey = await prompt(rl, `输入 ${keyName}`, existingKey === 'sk-your-key-here' ? '' : existingKey);
  if (newKey) config[keyName] = newKey;
}

async function setupEmbedding(rl: readline.Interface, config: EnvConfig): Promise<void> {
  console.log('\n━━━ Embedding 配置 ━━━');

  const provider = await promptChoice(rl, '选择 Embedding 提供商:', ['openai', 'dashscope'], config.EMBEDDING_PROVIDER || 'openai');
  config.EMBEDDING_PROVIDER = provider;

  const modelDefaults: Record<string, string> = {
    openai: 'text-embedding-3-small',
    dashscope: 'text-embedding-v2',
  };
  config.EMBEDDING_MODEL = await prompt(rl, 'Embedding 模型', config.EMBEDDING_MODEL || modelDefaults[provider]);

  // Embedding usually shares API key with LLM
  if (provider === config.LLM_PROVIDER) {
    const llmKey = config[config.LLM_PROVIDER === 'openai' ? 'OPENAI_API_KEY' : 'DASHSCOPE_API_KEY'];
    if (llmKey) {
      console.log(`  ✓ 复用 LLM 的 API Key`);
      return;
    }
  }

  const keyEnvMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    dashscope: 'DASHSCOPE_API_KEY',
  };
  const keyName = keyEnvMap[provider];
  if (!config[keyName]) {
    const newKey = await prompt(rl, `输入 ${keyName}`, '');
    if (newKey) config[keyName] = newKey;
  }
}

async function setupMilvus(rl: readline.Interface, config: EnvConfig): Promise<void> {
  console.log('\n━━━ Milvus 向量数据库 (可选) ━━━');
  console.log('  不配置 Milvus 时，知识库功能不可用，其他功能正常。');

  const enableMilvus = await promptConfirm(rl, '是否配置 Milvus?', false);
  if (!enableMilvus) {
    console.log('  ✓ 跳过 Milvus 配置（知识库功能将不可用）');
    return;
  }

  config.MILVUS_HOST = await prompt(rl, 'Milvus 主机', config.MILVUS_HOST || 'localhost');
  config.MILVUS_PORT = await prompt(rl, 'Milvus 端口', config.MILVUS_PORT || '19530');
  config.MILVUS_USERNAME = await prompt(rl, 'Milvus 用户名 (可选)', config.MILVUS_USERNAME || '');
  config.MILVUS_PASSWORD = await prompt(rl, 'Milvus 密码 (可选)', config.MILVUS_PASSWORD || '');
}

async function setupServer(rl: readline.Interface, config: EnvConfig): Promise<void> {
  console.log('\n━━━ 服务器配置 ━━━');

  config.PORT = await prompt(rl, '服务端口', config.PORT || '9900');
}

async function setupOptional(rl: readline.Interface, config: EnvConfig): Promise<void> {
  console.log('\n━━━ 可选配置 ━━━');

  const configureOptional = await promptConfirm(rl, '是否配置 Prometheus / CLS 等可选组件?', false);
  if (!configureOptional) {
    console.log('  ✓ 跳过可选配置');
    return;
  }

  config.PROMETHEUS_BASE_URL = await prompt(rl, 'Prometheus 地址', config.PROMETHEUS_BASE_URL || 'http://localhost:9090');
  config.PROMETHEUS_MOCK_ENABLED = await prompt(rl, 'Prometheus Mock 模式 (true/false)', config.PROMETHEUS_MOCK_ENABLED || 'false');
  config.CLS_MOCK_ENABLED = await prompt(rl, 'CLS 日志 Mock 模式 (true/false)', config.CLS_MOCK_ENABLED || 'false');
}

// ---------------------------------------------------------------------------
// Generate .env
// ---------------------------------------------------------------------------

function generateEnvContent(config: EnvConfig): string {
  const lines: string[] = [
    '# ============================================',
    '# SuperBiz Agent - 自动生成的配置',
    '# 运行 npm run setup 可重新配置',
    '# ============================================',
    '',
    '# Server',
    `PORT=${config.PORT || '9900'}`,
    '',
    '# LLM Provider (openai / anthropic / dashscope)',
    `LLM_PROVIDER=${config.LLM_PROVIDER || 'openai'}`,
    `LLM_MODEL=${config.LLM_MODEL || 'gpt-4o'}`,
    `OPENAI_API_KEY=${config.OPENAI_API_KEY || ''}`,
    `ANTHROPIC_API_KEY=${config.ANTHROPIC_API_KEY || ''}`,
    `DASHSCOPE_API_KEY=${config.DASHSCOPE_API_KEY || ''}`,
    '',
    '# Embedding Provider (openai / dashscope)',
    `EMBEDDING_PROVIDER=${config.EMBEDDING_PROVIDER || 'openai'}`,
    `EMBEDDING_MODEL=${config.EMBEDDING_MODEL || 'text-embedding-3-small'}`,
    '',
    '# Milvus (optional - leave default to disable)',
    `MILVUS_HOST=${config.MILVUS_HOST || 'localhost'}`,
    `MILVUS_PORT=${config.MILVUS_PORT || '19530'}`,
    `MILVUS_USERNAME=${config.MILVUS_USERNAME || ''}`,
    `MILVUS_PASSWORD=${config.MILVUS_PASSWORD || ''}`,
    `MILVUS_DATABASE=${config.MILVUS_DATABASE || 'default'}`,
    `MILVUS_TIMEOUT=${config.MILVUS_TIMEOUT || '10000'}`,
    '',
    '# RAG',
    `RAG_TOP_K=${config.RAG_TOP_K || '3'}`,
    `RAG_MODEL=${config.RAG_MODEL || config.LLM_MODEL || 'gpt-4o'}`,
    '',
    '# Prometheus',
    `PROMETHEUS_BASE_URL=${config.PROMETHEUS_BASE_URL || 'http://localhost:9090'}`,
    `PROMETHEUS_TIMEOUT=${config.PROMETHEUS_TIMEOUT || '10'}`,
    `PROMETHEUS_MOCK_ENABLED=${config.PROMETHEUS_MOCK_ENABLED || 'false'}`,
    '',
    '# CLS (Cloud Log Service)',
    `CLS_MOCK_ENABLED=${config.CLS_MOCK_ENABLED || 'false'}`,
    '',
    '# Agent Guard',
    `AGENT_GUARD_ENABLED=${config.AGENT_GUARD_ENABLED || 'true'}`,
    `AGENT_FAILURE_THRESHOLD=${config.AGENT_FAILURE_THRESHOLD || '3'}`,
    `AGENT_TOOL_CALL_LIMIT=${config.AGENT_TOOL_CALL_LIMIT || '12'}`,
    `AGENT_MODEL_CALL_LIMIT=${config.AGENT_MODEL_CALL_LIMIT || '25'}`,
    '',
    '# Release Precheck',
    `RELEASE_PRECHECK_ENABLED=${config.RELEASE_PRECHECK_ENABLED || 'true'}`,
    `RELEASE_PRECHECK_DEFAULT_TIMEOUT=${config.RELEASE_PRECHECK_DEFAULT_TIMEOUT || '900000'}`,
    `RELEASE_PRECHECK_HISTORY_FILE=${config.RELEASE_PRECHECK_HISTORY_FILE || './uploads/release-precheck-history.json'}`,
    `RELEASE_PRECHECK_WEIGHT_AUDIT_FILE=${config.RELEASE_PRECHECK_WEIGHT_AUDIT_FILE || './uploads/release-precheck-weight-audit.json'}`,
    '',
    '# Code Review',
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
    '# Document Chunking',
    `DOCUMENT_CHUNK_MAX_SIZE=${config.DOCUMENT_CHUNK_MAX_SIZE || '800'}`,
    `DOCUMENT_CHUNK_OVERLAP=${config.DOCUMENT_CHUNK_OVERLAP || '100'}`,
    '',
    '# File Upload',
    `FILE_UPLOAD_PATH=${config.FILE_UPLOAD_PATH || './uploads'}`,
    `FILE_UPLOAD_ALLOWED_EXTENSIONS=${config.FILE_UPLOAD_ALLOWED_EXTENSIONS || 'txt,md'}`,
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     SuperBiz Agent - 交互式配置工具       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  const rl = readline.createInterface({ input, output });

  try {
    // Load existing config
    const config = await loadExistingEnv();
    const hasExisting = Object.keys(config).length > 0;

    if (hasExisting) {
      console.log('  ✓ 检测到已有 .env 配置，将使用现有值作为默认值。');
      const reconfigure = await promptConfirm(rl, '是否重新配置?', true);
      if (!reconfigure) {
        console.log('\n  保持现有配置不变。');
        return;
      }
    }

    // Run setup sections
    await setupServer(rl, config);
    await setupLLM(rl, config);
    await setupEmbedding(rl, config);
    await setupMilvus(rl, config);
    await setupOptional(rl, config);

    // Preview
    console.log('\n━━━ 配置预览 ━━━');
    console.log(`  端口:       ${config.PORT}`);
    console.log(`  LLM:        ${config.LLM_PROVIDER} / ${config.LLM_MODEL}`);
    console.log(`  Embedding:  ${config.EMBEDDING_PROVIDER} / ${config.EMBEDDING_MODEL}`);
    console.log(`  Milvus:     ${config.MILVUS_HOST}:${config.MILVUS_PORT} (知识库${config.MILVUS_HOST === 'localhost' && !config.MILVUS_PASSWORD ? '未配置' : '已配置'})`);

    const confirm = await promptConfirm(rl, '\n确认写入 .env 文件?', true);
    if (!confirm) {
      console.log('\n  已取消，未写入任何文件。');
      return;
    }

    // Write .env
    const content = generateEnvContent(config);
    await writeFile(ENV_PATH, content, 'utf-8');

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║           配置完成!                       ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
    console.log('  .env 文件已生成。');
    console.log('');
    console.log('  启动服务:');
    console.log('    npm run dev');
    console.log('');
    console.log('  打开浏览器:');
    console.log('    http://localhost:' + (config.PORT || '9900'));
    console.log('');
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
