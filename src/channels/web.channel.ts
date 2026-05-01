import type {
  ChatChannel,
  IncomingMessage,
  MessageHandler,
  OutgoingMessage,
} from './types.js';

/**
 * Web chat channel stub (HTTP/SSE based).
 *
 * This is a placeholder for the web channel implementation.
 * The full implementation will be completed in Phase 3 when the
 * Chat service and routes are wired up.
 *
 * Design notes:
 * - Incoming messages arrive via HTTP POST /api/chat endpoints
 * - Responses are streamed back via SSE (text/event-stream)
 * - Session management is handled externally by ChatService
 */
export class WebChannel implements ChatChannel {
  readonly name = 'web';

  private handler: MessageHandler | null = null;

  /**
   * Start the web channel.
   * Currently a no-op since the Hono HTTP server handles connections.
   */
  async connect(): Promise<void> {
    // The web channel is implicitly connected when the HTTP server starts.
    // No persistent connection to establish.
  }

  /**
   * Stop the web channel.
   * Currently a no-op.
   */
  async disconnect(): Promise<void> {
    this.handler = null;
  }

  /**
   * Register a handler for incoming messages.
   * In the web channel, messages are dispatched from HTTP route handlers.
   */
  onMessage(handler: MessageHandler): void {
    this.handler = handler;
  }

  /**
   * Send a message to a web session.
   * In practice, SSE responses are handled directly by route handlers.
   * This method is a placeholder for the unified channel interface.
   */
  async sendMessage(
    _channelId: string,
    _message: OutgoingMessage,
  ): Promise<void> {
    // TODO: Phase 3 - implement SSE response writing
    throw new Error('WebChannel.sendMessage is not yet implemented');
  }

  /**
   * Dispatch an incoming message to the registered handler.
   * Called from HTTP route handlers when a chat request arrives.
   */
  async receive(message: IncomingMessage): Promise<void> {
    if (!this.handler) {
      throw new Error('No message handler registered for web channel');
    }
    await this.handler(message);
  }
}
