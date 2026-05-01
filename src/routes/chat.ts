/**
 * Chat Routes
 *
 * Ported from Java ChatController.java.
 *
 * Endpoints:
 * - POST /api/chat          - Synchronous chat (returns JSON)
 * - POST /api/chat_stream   - SSE streaming chat
 * - POST /api/chat/clear    - Clear session history
 * - GET  /api/chat/session/:id - Get session info
 *
 * Session management uses a Map<string, SessionState> with a sliding window
 * of MAX_WINDOW_SIZE message pairs (matching Java ChatController).
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import pino from 'pino';
import type { AppConfig } from '../config/index.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { Tool } from 'ai';
import {
  createChatSession,
  executeChat,
  executeChatStream,
  buildSystemPrompt,
  type ChatSession,
} from '../services/chat.service.js';
import type { HistoryMessage } from '../types/chat.js';
import {
  successResponse,
  errorResponse,
} from '../types/common.js';

const logger = pino({ name: 'chat-routes' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of message pairs (user + assistant) in the sliding window. */
const MAX_WINDOW_SIZE = 6;

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

interface SessionState {
  sessionId: string;
  history: HistoryMessage[];
  createTime: number;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface ChatRouteDeps {
  providerRegistry: ProviderRegistry;
  config: AppConfig;
  tools: Record<string, Tool>;
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function getOrCreateSession(
  sessions: Map<string, SessionState>,
  sessionId: string,
): SessionState {
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }

  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      history: [],
      createTime: Date.now(),
    };
    sessions.set(sessionId, session);
    logger.info({ sessionId }, 'New session created');
  }

  return session;
}

function addMessagePair(
  session: SessionState,
  userQuestion: string,
  aiAnswer: string,
): void {
  session.history.push({ role: 'user', content: userQuestion });
  session.history.push({ role: 'assistant', content: aiAnswer });

  // Sliding window: keep at most MAX_WINDOW_SIZE pairs
  const maxMessages = MAX_WINDOW_SIZE * 2;
  while (session.history.length > maxMessages) {
    session.history.splice(0, 2);
  }

  logger.debug(
    { sessionId: session.sessionId, pairCount: session.history.length / 2 },
    'Session history updated',
  );
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

/**
 * Create a Hono router with all chat endpoints.
 *
 * The returned router is mounted at `/api` by the server app.
 * Route paths are relative: `/chat`, `/chat_stream`, `/chat/clear`, `/chat/session/:id`.
 */
export function createChatRoutes(deps: ChatRouteDeps): Hono {
  const { providerRegistry, config, tools } = deps;
  const sessions = new Map<string, SessionState>();
  const routes = new Hono();

  // -------------------------------------------------------------------------
  // POST /chat - Synchronous chat
  // -------------------------------------------------------------------------
  routes.post('/chat', async (c) => {
    try {
      const body = await c.req.json<{ Id?: string; id?: string; Question?: string; question?: string }>();
      const sessionId = body.Id ?? body.id ?? '';
      const question = body.Question ?? body.question ?? '';

      logger.info({ sessionId, question }, 'Received chat request');

      // Validate question
      if (!question.trim()) {
        return c.json(successResponse({ success: false, errorMessage: '问题内容不能为空' }));
      }

      // Get or create session
      const session = getOrCreateSession(sessions, sessionId);
      const history = [...session.history];

      logger.info({ sessionId: session.sessionId, historyPairs: history.length / 2 }, 'Session history');

      // Create chat session and execute
      const provider = providerRegistry.getDefaultLLM();
      const chatSession = createChatSession(provider, tools, config, history);
      const result = await executeChat(chatSession, question);

      // Update session history
      addMessagePair(session, question, result.text);

      return c.json(
        successResponse({
          success: true,
          answer: result.text,
        }),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Chat request failed');
      return c.json(successResponse({ success: false, errorMessage: message }));
    }
  });

  // -------------------------------------------------------------------------
  // POST /chat_stream - SSE streaming chat
  // -------------------------------------------------------------------------
  routes.post('/chat_stream', async (c) => {
    const body = await c.req.json<{ Id?: string; id?: string; Question?: string; question?: string }>();
    const sessionId = body.Id ?? body.id ?? '';
    const question = body.Question ?? body.question ?? '';

    // Validate question
    if (!question.trim()) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', data: '问题内容不能为空' }),
          event: 'message',
        });
      });
    }

    // Get or create session
    const session = getOrCreateSession(sessions, sessionId);
    const history = [...session.history];

    logger.info(
      { sessionId: session.sessionId, question, historyPairs: history.length / 2 },
      'Received streaming chat request',
    );

    return streamSSE(c, async (stream) => {
      // 5-minute timeout (matching Java SseEmitter timeout)
      const timeout = setTimeout(() => {
        logger.warn({ sessionId: session.sessionId }, 'SSE stream timeout');
        stream.close();
      }, 300_000);

      stream.onAbort(() => {
        logger.info({ sessionId: session.sessionId }, 'SSE stream aborted by client');
        clearTimeout(timeout);
      });

      try {
        // Create chat session and start streaming
        const provider = providerRegistry.getDefaultLLM();
        const chatSession = createChatSession(provider, tools, config, history);
        const streamResult = await executeChatStream(chatSession, question);

        // Accumulate full answer for session history
        let fullAnswer = '';

        // Consume the text stream and send SSE events
        for await (const chunk of streamResult.stream.textStream) {
          fullAnswer += chunk;

          await stream.writeSSE({
            data: JSON.stringify({ type: 'content', data: chunk }),
            event: 'message',
          });
        }

        // Wait for stats (ensures agent has fully completed)
        await streamResult.stats;

        // Update session history
        addMessagePair(session, question, fullAnswer);

        logger.info(
          { sessionId: session.sessionId, answerLength: fullAnswer.length },
          'Streaming chat completed',
        );

        // Send done signal
        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', data: null }),
          event: 'message',
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message, sessionId: session.sessionId }, 'Streaming chat failed');

        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', data: message }),
          event: 'message',
        });
      } finally {
        clearTimeout(timeout);
      }
    });
  });

  // -------------------------------------------------------------------------
  // POST /chat/clear - Clear session history
  // -------------------------------------------------------------------------
  routes.post('/chat/clear', async (c) => {
    try {
      const body = await c.req.json<{ Id?: string; id?: string }>();
      const sessionId = body.Id ?? body.id ?? '';

      logger.info({ sessionId }, 'Received clear session request');

      if (!sessionId) {
        return c.json(errorResponse('会话ID不能为空'));
      }

      const session = sessions.get(sessionId);
      if (session) {
        session.history = [];
        logger.info({ sessionId }, 'Session history cleared');
        return c.json(successResponse('会话历史已清空'));
      } else {
        return c.json(errorResponse('会话不存在'));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Clear session failed');
      return c.json(errorResponse(message));
    }
  });

  // -------------------------------------------------------------------------
  // GET /chat/session/:id - Get session info
  // -------------------------------------------------------------------------
  routes.get('/chat/session/:id', async (c) => {
    try {
      const sessionId = c.req.param('id');

      logger.info({ sessionId }, 'Received get session info request');

      const session = sessions.get(sessionId);
      if (session) {
        return c.json(
          successResponse({
            sessionId: session.sessionId,
            messagePairCount: session.history.length / 2,
            createTime: session.createTime,
          }),
        );
      } else {
        return c.json(errorResponse('会话不存在'));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ error: message }, 'Get session info failed');
      return c.json(errorResponse(message));
    }
  });

  return routes;
}
