/**
 * A ChatChannel represents a communication endpoint (e.g. web, Slack, Discord).
 * Each channel implements message sending and receiving through a unified interface.
 */
export interface ChatChannel {
  /** Unique channel name (e.g. "web", "slack", "discord") */
  name: string;
  /** Establish connection / start listening */
  connect(): Promise<void>;
  /** Tear down connection */
  disconnect(): Promise<void>;
  /** Register a handler for incoming messages */
  onMessage(handler: MessageHandler): void;
  /** Send a message to a specific conversation within this channel */
  sendMessage(channelId: string, message: OutgoingMessage): Promise<void>;
}

/**
 * An incoming message from a chat channel.
 */
export interface IncomingMessage {
  /** Source channel name (web, slack, discord) */
  channel: string;
  /** Conversation / thread ID within the channel */
  channelId: string;
  /** Sender user identifier */
  userId: string;
  /** Message text content */
  content: string;
  /** Optional metadata (attachments, mentions, etc.) */
  metadata?: Record<string, unknown>;
}

/**
 * An outgoing message to be sent through a chat channel.
 */
export interface OutgoingMessage {
  /** Message text content */
  content: string;
  /** Content format */
  format: 'text' | 'markdown' | 'sse';
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Handler function for incoming messages.
 */
export type MessageHandler = (message: IncomingMessage) => Promise<void>;

/**
 * Registry for managing multiple chat channels.
 */
export interface ChannelRegistry {
  /** Register a chat channel */
  register(channel: ChatChannel): void;
  /** Get a channel by name. Throws if not found. */
  get(name: string): ChatChannel;
  /** List all registered channels */
  list(): ChatChannel[];
}
