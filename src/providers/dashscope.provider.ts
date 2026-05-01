import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed } from 'ai';
import type { LanguageModel } from 'ai';
import type { LLMProvider, EmbeddingProvider } from './types.js';
import { ProviderError } from './types.js';

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

interface DashScopeProviderOptions {
  apiKey: string;
  baseURL?: string;
}

/**
 * DashScope LLM provider using @ai-sdk/openai-compatible.
 *
 * DashScope exposes an OpenAI-compatible API at dashscope.aliyuncs.com.
 */
export function createDashScopeLLMProvider(options: DashScopeProviderOptions): LLMProvider {
  const sdk = createOpenAICompatible({
    name: 'dashscope',
    apiKey: options.apiKey,
    baseURL: options.baseURL ?? DASHSCOPE_BASE_URL,
  });

  return {
    name: 'dashscope',

    chatModel(modelId: string): LanguageModel {
      return sdk.chatModel(modelId);
    },

    isAvailable(): boolean {
      return options.apiKey.length > 0;
    },
  };
}

/**
 * DashScope Embedding provider using @ai-sdk/openai-compatible.
 *
 * Uses DashScope's OpenAI-compatible embedding endpoint.
 */
export function createDashScopeEmbeddingProvider(options: DashScopeProviderOptions): EmbeddingProvider {
  const sdk = createOpenAICompatible({
    name: 'dashscope',
    apiKey: options.apiKey,
    baseURL: options.baseURL ?? DASHSCOPE_BASE_URL,
  });

  return {
    name: 'dashscope',

    async embed(texts: string[]): Promise<number[][]> {
      try {
        const results = await Promise.all(
          texts.map(async (text) => {
            const { embedding } = await embed({
              model: sdk.textEmbeddingModel('text-embedding-v4'),
              value: text,
            });
            return embedding as number[];
          }),
        );
        return results;
      } catch (cause) {
        throw new ProviderError(
          'DashScope embedding failed',
          'dashscope',
          cause,
        );
      }
    },

    isAvailable(): boolean {
      return options.apiKey.length > 0;
    },
  };
}
