/**
 * Document chunk - ported from Java DocumentChunk.java
 */
export interface DocumentChunk {
  /** Chunk content */
  content: string;
  /** Start position in the original document */
  startIndex: number;
  /** End position in the original document */
  endIndex: number;
  /** Chunk index (0-based) */
  chunkIndex: number;
  /** Section title or context info */
  title?: string;
}
