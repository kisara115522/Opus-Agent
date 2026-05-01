/**
 * Chat request DTO, matching ChatController.ChatRequest.
 * Accepts flexible casing for frontend compatibility.
 */
export interface ChatRequest {
  /** Session ID */
  id: string;
  /** User question content */
  question: string;
}

/**
 * Chat response DTO, matching ChatController.ChatResponse.
 */
export interface ChatResponse {
  /** Whether the request succeeded */
  success: boolean;
  /** AI answer (present when success=true) */
  answer?: string;
  /** Error message (present when success=false) */
  errorMessage?: string;
}

/**
 * SSE stream message format, matching ChatController.SseMessage.
 */
export interface SseMessage {
  /** Message type: content chunk, error, or stream end */
  type: 'content' | 'error' | 'done';
  /** Message payload */
  data: string | null;
}

/**
 * Session info response, matching ChatController.SessionInfoResponse.
 */
export interface SessionInfo {
  /** Session identifier */
  sessionId: string;
  /** Number of message pairs (user + assistant) */
  messagePairCount: number;
  /** Session creation timestamp (epoch millis) */
  createTime: number;
}

/**
 * Clear session request DTO.
 */
export interface ClearRequest {
  /** Session ID to clear */
  id: string;
}

/**
 * Internal session history message entry.
 */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}
