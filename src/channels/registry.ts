import type { ChatChannel, ChannelRegistry } from './types.js';

/**
 * Default ChannelRegistry implementation.
 * Manages registration and lookup of chat channels.
 */
export class DefaultChannelRegistry implements ChannelRegistry {
  private readonly channels = new Map<string, ChatChannel>();

  /** Register a channel. Overwrites any existing channel with the same name. */
  register(channel: ChatChannel): void {
    this.channels.set(channel.name, channel);
  }

  /** Get a channel by name. Throws if not found. */
  get(name: string): ChatChannel {
    const channel = this.channels.get(name);
    if (!channel) {
      throw new Error(`Channel not found: ${name}`);
    }
    return channel;
  }

  /** List all registered channels. */
  list(): ChatChannel[] {
    return Array.from(this.channels.values());
  }
}
