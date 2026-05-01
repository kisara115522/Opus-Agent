import type { LLMProvider, EmbeddingProvider } from './types.js';
import { ProviderError } from './types.js';

/**
 * Central registry for LLM and Embedding providers.
 *
 * Providers are registered at startup (typically driven by config) and
 * looked up by name when services need to call an LLM or generate embeddings.
 */
export class ProviderRegistry {
  private llmProviders = new Map<string, LLMProvider>();
  private embeddingProviders = new Map<string, EmbeddingProvider>();

  private defaultLlmName: string | undefined;
  private defaultEmbeddingName: string | undefined;

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  registerLLM(provider: LLMProvider): void {
    this.llmProviders.set(provider.name, provider);
  }

  registerEmbedding(provider: EmbeddingProvider): void {
    this.embeddingProviders.set(provider.name, provider);
  }

  /** Mark a previously-registered LLM provider as the default. */
  setDefaultLLM(name: string): void {
    if (!this.llmProviders.has(name)) {
      throw new ProviderError(
        `Cannot set default LLM provider "${name}": not registered`,
        name,
      );
    }
    this.defaultLlmName = name;
  }

  /** Mark a previously-registered Embedding provider as the default. */
  setDefaultEmbedding(name: string): void {
    if (!this.embeddingProviders.has(name)) {
      throw new ProviderError(
        `Cannot set default Embedding provider "${name}": not registered`,
        name,
      );
    }
    this.defaultEmbeddingName = name;
  }

  // -----------------------------------------------------------------------
  // Lookup
  // -----------------------------------------------------------------------

  getLLM(name: string): LLMProvider {
    const provider = this.llmProviders.get(name);
    if (!provider) {
      throw new ProviderError(
        `LLM provider "${name}" not found. Registered: [${[...this.llmProviders.keys()].join(', ')}]`,
        name,
      );
    }
    return provider;
  }

  getEmbedding(name: string): EmbeddingProvider {
    const provider = this.embeddingProviders.get(name);
    if (!provider) {
      throw new ProviderError(
        `Embedding provider "${name}" not found. Registered: [${[...this.embeddingProviders.keys()].join(', ')}]`,
        name,
      );
    }
    return provider;
  }

  getDefaultLLM(): LLMProvider {
    if (!this.defaultLlmName) {
      throw new ProviderError(
        'No default LLM provider set. Call setDefaultLLM() first.',
        '',
      );
    }
    return this.getLLM(this.defaultLlmName);
  }

  getDefaultEmbedding(): EmbeddingProvider {
    if (!this.defaultEmbeddingName) {
      throw new ProviderError(
        'No default Embedding provider set. Call setDefaultEmbedding() first.',
        '',
      );
    }
    return this.getEmbedding(this.defaultEmbeddingName);
  }

  // -----------------------------------------------------------------------
  // Introspection
  // -----------------------------------------------------------------------

  listLLM(): string[] {
    return [...this.llmProviders.keys()];
  }

  listEmbedding(): string[] {
    return [...this.embeddingProviders.keys()];
  }
}
