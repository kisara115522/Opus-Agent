import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { LLMProvider } from './types.js';

interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
}

/**
 * Anthropic LLM provider using @ai-sdk/anthropic.
 *
 * Note: Anthropic does not provide an embedding API, so only an LLM provider
 * is created here.
 */
export function createAnthropicLLMProvider(options: AnthropicProviderOptions): LLMProvider {
  const sdk = createAnthropic({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
  });

  return {
    name: 'anthropic',

    chatModel(modelId: string): LanguageModel {
      return sdk(modelId);
    },

    isAvailable(): boolean {
      return options.apiKey.length > 0;
    },
  };
}
