import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import type { LanguageModel } from 'ai';
import type { LLMProvider, EmbeddingProvider } from './types.js';
import { ProviderError } from './types.js';

interface OpenAIProviderOptions {
  apiKey: string;
  baseURL?: string;
}

/**
 * OpenAI LLM provider using @ai-sdk/openai.
 */
export function createOpenAILLMProvider(options: OpenAIProviderOptions): LLMProvider {
  const sdk = createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  });

  return {
    name: 'openai',

    chatModel(modelId: string): LanguageModel {
      return sdk(modelId);
    },

    isAvailable(): boolean {
      return options.apiKey.length > 0;
    },
  };
}

/**
 * OpenAI Embedding provider using @ai-sdk/openai.
 */
export function createOpenAIEmbeddingProvider(options: OpenAIProviderOptions): EmbeddingProvider {
  const sdk = createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  });

  return {
    name: 'openai',

    async embed(texts: string[]): Promise<number[][]> {
      try {
        const results = await Promise.all(
          texts.map(async (text) => {
            const { embedding } = await embed({
              model: sdk.textEmbedding('text-embedding-3-small'),
              value: text,
            });
            return embedding as number[];
          }),
        );
        return results;
      } catch (cause) {
        throw new ProviderError(
          'OpenAI embedding failed',
          'openai',
          cause,
        );
      }
    },

    isAvailable(): boolean {
      return options.apiKey.length > 0;
    },
  };
}
