import type { LanguageModel } from 'ai';

/**
 * Abstract interface for LLM chat providers.
 *
 * Implementations wrap provider-specific SDKs (OpenAI, Anthropic, DashScope)
 * behind a uniform surface so the rest of the application is provider-agnostic.
 */
export interface LLMProvider {
  /** Human-readable provider name (e.g. "openai", "anthropic"). */
  readonly name: string;

  /**
   * Return a Vercel AI SDK LanguageModel for the given model id.
   *
   * @param modelId - Provider-specific model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514").
   */
  chatModel(modelId: string): LanguageModel;

  /**
   * Whether this provider is properly configured and ready to use.
   * Typically checks that the API key is present.
   */
  isAvailable(): boolean;
}

/**
 * Abstract interface for embedding providers.
 *
 * Embeddings are returned as arrays of floating-point vectors, one per input text.
 */
export interface EmbeddingProvider {
  /** Human-readable provider name (e.g. "openai", "dashscope"). */
  readonly name: string;

  /**
   * Generate embeddings for one or more text strings.
   *
   * @param texts - Array of text strings to embed.
   * @returns Promise resolving to an array of embedding vectors (one per input text).
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Whether this provider is properly configured and ready to use.
   * Typically checks that the API key is present.
   */
  isAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  public readonly providerName: string;
  public readonly cause?: unknown;

  constructor(message: string, providerName: string, cause?: unknown) {
    super(message);
    this.name = 'ProviderError';
    this.providerName = providerName;
    this.cause = cause;
  }
}
