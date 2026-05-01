import { EventEmitter } from 'node:events';

/**
 * All agent lifecycle event types.
 */
export type AgentEvent =
  | 'agent:start'
  | 'agent:end'
  | 'tool:call'
  | 'tool:result'
  | 'tool:error'
  | 'model:call'
  | 'model:response'
  | 'guard:trip'
  | 'session:create'
  | 'session:expire';

/**
 * Typed event bus interface for agent lifecycle events.
 */
export interface EventBus {
  /** Subscribe to an event */
  on(event: AgentEvent, handler: (payload: unknown) => void): void;
  /** Emit an event with a payload */
  emit(event: AgentEvent, payload: unknown): void;
  /** Unsubscribe from an event */
  off(event: AgentEvent, handler: (payload: unknown) => void): void;
  /** Remove all listeners for an event (or all events if omitted) */
  removeAllListeners(event?: AgentEvent): void;
}

/**
 * Simple EventEmitter-based EventBus implementation.
 * Uses Node.js EventEmitter under the hood with typed event names.
 */
export class DefaultEventBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Allow more than the default 10 listeners per event
    this.emitter.setMaxListeners(50);
  }

  on(event: AgentEvent, handler: (payload: unknown) => void): void {
    this.emitter.on(event, handler);
  }

  emit(event: AgentEvent, payload: unknown): void {
    this.emitter.emit(event, payload);
  }

  off(event: AgentEvent, handler: (payload: unknown) => void): void {
    this.emitter.off(event, handler);
  }

  removeAllListeners(event?: AgentEvent): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }
}
