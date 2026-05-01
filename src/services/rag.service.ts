/**
 * RAG (Retrieval-Augmented Generation) Service
 *
 * Ported from Java RagService.java.
 *
 * Combines vector similarity search with LLM generation to answer questions
 * grounded in the internal knowledge base.
 *
 * Design:
 * - Uses VectorSearchService for document retrieval
 * - Uses the Vercel AI SDK (generateText / streamText) for LLM generation,
 *   making it provider-agnostic
 * - Supports both synchronous and streaming response modes
 * - Conversation history is injected as prior messages for multi-turn context
 */

import { generateText, streamText, type CoreMessage, type ToolSet, type StreamTextResult } from 'ai';
import pino from 'pino';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { LLMProvider } from '../providers/types.js';
import type { EmbeddingConfig } from '../config/stub.js';
import type { AppConfig } from '../config/index.js';
import { searchSimilarDocuments, type SearchResult } from './vector-search.service.js';
import type { HistoryMessage } from '../types/chat.js';

const logger = pino({ name: 'rag-service' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for RAG queries.
 */
export interface RagQueryOptions {
  /** Number of documents to retrieve (default: from config.rag.topK). */
  topK?: number;
  /** Conversation history for multi-turn context. */
  history?: HistoryMessage[];
}

/**
 * Result of a synchronous RAG query.
 */
export interface RagResult {
  /** The generated answer. */
  answer: string;
  /** The search results used as context. */
  searchResults: SearchResult[];
  /** The constructed context string sent to the LLM. */
  context: string;
}

/**
 * Result of a streaming RAG query.
 */
export interface RagStreamResult {
  /** The text stream from the LLM. */
  stream: StreamTextResult<ToolSet, never>;
  /** The search results used as context (available immediately). */
  searchResults: SearchResult[];
  /** The constructed context string sent to the LLM. */
  context: string;
  /** Promise that resolves with the full answer text when the stream completes. */
  fullText: Promise<string>;
}

// ---------------------------------------------------------------------------
// RAG Service
// ---------------------------------------------------------------------------

export interface RagServiceDeps {
  /** Milvus client for vector search. */
  milvusClient: MilvusClient;
  /** Embedding configuration for query vector generation. */
  embeddingConfig: EmbeddingConfig;
  /** LLM provider for text generation. */
  llmProvider: LLMProvider;
  /** Application configuration. */
  config: AppConfig;
}

/**
 * RAG service that combines vector search with LLM generation.
 *
 * Usage:
 * ```ts
 * const ragService = createRagService({ milvusClient, embeddingConfig, llmProvider, config });
 * const result = await ragService.queryWithContext('How to deploy?');
 * ```
 */
export class RagService {
  private readonly milvusClient: MilvusClient;
  private readonly embeddingConfig: EmbeddingConfig;
  private readonly llmProvider: LLMProvider;
  private readonly config: AppConfig;

  constructor(deps: RagServiceDeps) {
    this.milvusClient = deps.milvusClient;
    this.embeddingConfig = deps.embeddingConfig;
    this.llmProvider = deps.llmProvider;
    this.config = deps.config;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Synchronous RAG query: search -> build context -> generate answer.
   *
   * Mirrors Java RagService.queryStream() logic (without the streaming callback).
   *
   * @param question - User's question
   * @param options  - Optional topK override and conversation history
   * @returns The answer text and the search results used
   */
  async queryWithContext(
    question: string,
    options: RagQueryOptions = {},
  ): Promise<RagResult> {
    const topK = options.topK ?? this.config.rag.topK;
    const history = options.history ?? [];

    logger.info({ question, topK }, 'RAG synchronous query');

    // 1. Retrieve similar documents
    const searchResults = await this.searchDocuments(question, topK);

    if (searchResults.length === 0) {
      logger.warn('No relevant documents found');
      return {
        answer: '抱歉，我在知识库中没有找到相关信息来回答您的问题。',
        searchResults: [],
        context: '',
      };
    }

    // 2. Build context and generate answer
    const context = this.buildContext(searchResults);
    const messages = this.buildMessages(question, context, history);

    const model = this.llmProvider.chatModel(this.config.rag.model);

    const result = await generateText({
      model,
      messages,
    });

    logger.info(
      { answerLength: result.text.length, searchResultCount: searchResults.length },
      'RAG synchronous query completed',
    );

    return {
      answer: result.text,
      searchResults,
      context,
    };
  }

  /**
   * Streaming RAG query: search -> build context -> stream answer.
   *
   * Mirrors Java RagService.queryStream() with StreamCallback.
   *
   * @param question - User's question
   * @param options  - Optional topK override and conversation history
   * @returns Stream result with search results available immediately
   */
  async queryWithContextStream(
    question: string,
    options: RagQueryOptions = {},
  ): Promise<RagStreamResult> {
    const topK = options.topK ?? this.config.rag.topK;
    const history = options.history ?? [];

    logger.info({ question, topK }, 'RAG streaming query');

    // 1. Retrieve similar documents
    const searchResults = await this.searchDocuments(question, topK);

    if (searchResults.length === 0) {
      logger.warn('No relevant documents found');
      // Return a synthetic stream with the empty-result message
      const emptyAnswer = '抱歉，我在知识库中没有找到相关信息来回答您的问题。';
      const emptyStream = streamText({
        model: this.llmProvider.chatModel(this.config.rag.model),
        prompt: emptyAnswer,
      });
      return {
        stream: emptyStream,
        searchResults: [],
        context: '',
        fullText: Promise.resolve(emptyAnswer),
      };
    }

    // 2. Build context and messages
    const context = this.buildContext(searchResults);
    const messages = this.buildMessages(question, context, history);

    const model = this.llmProvider.chatModel(this.config.rag.model);

    const stream = streamText({
      model,
      messages,
    });

    const fullText = (async () => {
      const text = await stream.text;
      logger.info(
        { answerLength: text.length, searchResultCount: searchResults.length },
        'RAG streaming query completed',
      );
      return text;
    })();

    return {
      stream,
      searchResults,
      context,
      fullText,
    };
  }

  // -------------------------------------------------------------------------
  // Private: Document search
  // -------------------------------------------------------------------------

  private async searchDocuments(
    question: string,
    topK: number,
  ): Promise<SearchResult[]> {
    try {
      return await searchSimilarDocuments(
        question,
        topK,
        this.milvusClient,
        this.embeddingConfig,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Document search failed in RAG service');
      throw new Error(`RAG search failed: ${message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Private: Context and prompt construction
  // -------------------------------------------------------------------------

  /**
   * Build a context string from search results.
   * Mirrors Java RagService.buildContext().
   */
  private buildContext(searchResults: SearchResult[]): string {
    const parts: string[] = [];
    for (let i = 0; i < searchResults.length; i++) {
      parts.push(`【参考资料 ${i + 1}】`);
      parts.push(searchResults[i].content);
      parts.push(''); // blank line separator
    }
    return parts.join('\n');
  }

  /**
   * Build the message array for the LLM, incorporating history and the
   * RAG-augmented prompt.
   * Mirrors Java RagService.buildPrompt() + generateAnswerStream() message construction.
   */
  private buildMessages(
    question: string,
    context: string,
    history: HistoryMessage[],
  ): CoreMessage[] {
    const messages: CoreMessage[] = [];

    // System message with RAG instructions
    messages.push({
      role: 'system',
      content:
        '你是一个专业的AI助手。请根据以下参考资料回答用户的问题。\n\n' +
        `参考资料：\n${context}\n` +
        `用户问题：${question}\n\n` +
        '请基于上述参考资料给出准确、详细的回答。如果参考资料中没有相关信息，请明确说明。',
    });

    // Inject conversation history as prior user/assistant turns
    for (const msg of history) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Current user question
    messages.push({
      role: 'user',
      content: question,
    });

    logger.debug(
      { messageCount: messages.length, historyCount: history.length },
      'Built RAG message array',
    );

    return messages;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a RAG service instance.
 */
export function createRagService(deps: RagServiceDeps): RagService {
  return new RagService(deps);
}
