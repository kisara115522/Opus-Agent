import type { AppConfig } from '../config/index.js';
import { ProviderRegistry } from './registry.js';
import { createOpenAILLMProvider, createOpenAIEmbeddingProvider } from './openai.provider.js';
import { createAnthropicLLMProvider } from './anthropic.provider.js';
import { createDashScopeLLMProvider, createDashScopeEmbeddingProvider } from './dashscope.provider.js';

export type { LLMProvider, EmbeddingProvider } from './types.js';
export { ProviderError } from './types.js';
export { ProviderRegistry } from './registry.js';
export { createOpenAILLMProvider, createOpenAIEmbeddingProvider } from './openai.provider.js';
export { createAnthropicLLMProvider } from './anthropic.provider.js';
export { createDashScopeLLMProvider, createDashScopeEmbeddingProvider } from './dashscope.provider.js';

/**
 * Create and configure a ProviderRegistry from application config.
 *
 * Registers all supported providers and sets the defaults based on
 * config.llm.provider and config.embedding.provider.
 */
export function createProviderRegistry(config: AppConfig): ProviderRegistry {
  const registry = new ProviderRegistry();

  // --- LLM providers ---
  registry.registerLLM(
    createOpenAILLMProvider({ apiKey: config.llm.apiKey }),
  );
  registry.registerLLM(
    createAnthropicLLMProvider({ apiKey: config.llm.apiKey }),
  );
  registry.registerLLM(
    createDashScopeLLMProvider({ apiKey: config.llm.apiKey }),
  );
  registry.setDefaultLLM(config.llm.provider);

  // --- Embedding providers ---
  registry.registerEmbedding(
    createOpenAIEmbeddingProvider({ apiKey: config.embedding.apiKey }),
  );
  registry.registerEmbedding(
    createDashScopeEmbeddingProvider({ apiKey: config.embedding.apiKey }),
  );
  registry.setDefaultEmbedding(config.embedding.provider);

  return registry;
}
