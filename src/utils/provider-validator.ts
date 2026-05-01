const PROVIDER_PREFIXES: Record<string, { prefix: string; minLength: number }> = {
  openai: { prefix: 'sk-', minLength: 20 },
  anthropic: { prefix: 'sk-ant-', minLength: 20 },
  dashscope: { prefix: '', minLength: 10 },
  custom: { prefix: '', minLength: 5 },
};

export function validateApiKeyFormat(
  provider: string,
  key: string
): { valid: boolean; message: string } {
  const normalizedProvider = provider.toLowerCase();
  const config = PROVIDER_PREFIXES[normalizedProvider];

  if (!config) {
    return { valid: false, message: `Unknown provider: ${provider}` };
  }

  if (!key || key.trim().length === 0) {
    return { valid: false, message: 'API key cannot be empty' };
  }

  if (config.prefix && !key.startsWith(config.prefix)) {
    return {
      valid: false,
      message: `${normalizedProvider} API key must start with "${config.prefix}"`,
    };
  }

  if (key.length < config.minLength) {
    return {
      valid: false,
      message: `${normalizedProvider} API key must be at least ${config.minLength} characters`,
    };
  }

  return { valid: true, message: 'API key format is valid' };
}

const TIMEOUT_MS = 10_000;

function createTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms).unref();
  return controller.signal;
}

async function testOpenAI(
  apiKey: string
): Promise<{ success: boolean; message: string; models?: string[] }> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: createTimeoutSignal(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      success: false,
      message: `OpenAI API returned ${res.status}: ${body || res.statusText}`,
    };
  }

  const data = (await res.json()) as { data?: { id: string }[] };
  const models = data.data?.map((m) => m.id).sort() ?? [];
  return { success: true, message: 'Connected to OpenAI successfully', models };
}

async function testAnthropic(
  apiKey: string,
  model?: string
): Promise<{ success: boolean; message: string; models?: string[] }> {
  const selectedModel = model ?? 'claude-haiku-4-20250514';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: selectedModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
    signal: createTimeoutSignal(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      success: false,
      message: `Anthropic API returned ${res.status}: ${body || res.statusText}`,
    };
  }

  return {
    success: true,
    message: 'Connected to Anthropic successfully',
  };
}

async function testDashScope(
  apiKey: string,
  model?: string
): Promise<{ success: boolean; message: string; models?: string[] }> {
  const selectedModel = model ?? 'qwen-turbo';
  const res = await fetch(
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: createTimeoutSignal(TIMEOUT_MS),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      success: false,
      message: `DashScope API returned ${res.status}: ${body || res.statusText}`,
    };
  }

  return {
    success: true,
    message: 'Connected to DashScope successfully',
  };
}

export async function testProviderConnection(
  provider: string,
  apiKey: string,
  model?: string
): Promise<{ success: boolean; message: string; models?: string[] }> {
  const normalizedProvider = provider.toLowerCase();

  try {
    switch (normalizedProvider) {
      case 'openai':
        return await testOpenAI(apiKey);
      case 'anthropic':
        return await testAnthropic(apiKey, model);
      case 'dashscope':
        return await testDashScope(apiKey, model);
      default:
        return {
          success: false,
          message: `Connection test not supported for provider: ${provider}`,
        };
    }
  } catch (error: unknown) {
    const isTimeout =
      error instanceof DOMException && error.name === 'AbortError';
    const reason =
      error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: isTimeout
        ? `Connection to ${normalizedProvider} timed out after ${TIMEOUT_MS / 1000}s`
        : `Failed to connect to ${normalizedProvider}: ${reason}`,
    };
  }
}

export function getDefaultModels(provider: string): string[] {
  const normalizedProvider = provider.toLowerCase();
  const models: Record<string, string[]> = {
    openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o3'],
    anthropic: [
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-20250514',
    ],
    dashscope: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  };
  return models[normalizedProvider] ?? [];
}

export function getDefaultEmbeddingModels(provider: string): string[] {
  const normalizedProvider = provider.toLowerCase();
  const models: Record<string, string[]> = {
    openai: ['text-embedding-3-small', 'text-embedding-3-large'],
    dashscope: ['text-embedding-v2'],
  };
  return models[normalizedProvider] ?? [];
}
