/**
 * Document chunk service - ported from Java DocumentChunkService.java
 *
 * Markdown-aware document chunking logic:
 * - Split by headings, then paragraphs
 * - Configurable maxSize (default 800) and overlap (default 100)
 * - Overlap tries to break at sentence boundaries (Chinese punctuation)
 */

import pino from 'pino';
import type { DocumentChunk } from '../types/document-chunk.js';
import type { DocumentChunkConfig } from '../config/stub.js';

const logger = pino({ name: 'document-chunk' });

interface Section {
  title: string | null;
  content: string;
  startIndex: number;
}

/**
 * Chunk a document into semantic sections.
 *
 * @param content  - Document text content
 * @param filePath - File path (for logging)
 * @param cfg      - Chunk configuration (maxSize, overlap)
 * @returns Array of document chunks
 */
export function chunkDocument(
  content: string,
  filePath: string,
  cfg: DocumentChunkConfig,
): DocumentChunk[] {
  if (!content || content.trim().length === 0) {
    logger.warn({ filePath }, 'Document content is empty');
    return [];
  }

  // 1. Split by Markdown headings
  const sections = splitByHeadings(content);

  // 2. Chunk each section further
  const chunks: DocumentChunk[] = [];
  let globalChunkIndex = 0;

  for (const section of sections) {
    const sectionChunks = chunkSection(section, globalChunkIndex, cfg);
    chunks.push(...sectionChunks);
    globalChunkIndex += sectionChunks.length;
  }

  logger.info({ filePath, chunkCount: chunks.length }, 'Document chunking complete');
  return chunks;
}

/**
 * Split document by Markdown headings (# ... ######)
 */
export function splitByHeadings(content: string): Section[] {
  const sections: Section[] = [];
  const headingPattern = /^(#{1,6})\s+(.+)$/gm;

  let lastEnd = 0;
  let currentTitle: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(content)) !== null) {
    // Save the previous section
    if (lastEnd < match.index) {
      const sectionContent = content.slice(lastEnd, match.index).trim();
      if (sectionContent.length > 0) {
        sections.push({ title: currentTitle, content: sectionContent, startIndex: lastEnd });
      }
    }

    currentTitle = match[2].trim();
    lastEnd = match.index;
  }

  // Add the last section
  if (lastEnd < content.length) {
    const sectionContent = content.slice(lastEnd).trim();
    if (sectionContent.length > 0) {
      sections.push({ title: currentTitle, content: sectionContent, startIndex: lastEnd });
    }
  }

  // If no headings found, treat the whole document as one section
  if (sections.length === 0) {
    sections.push({ title: null, content, startIndex: 0 });
  }

  return sections;
}

/**
 * Chunk a single section. If the section fits within maxSize, return as-is.
 * Otherwise, split by paragraphs with overlap.
 */
function chunkSection(
  section: Section,
  startChunkIndex: number,
  cfg: DocumentChunkConfig,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const { content, title, startIndex } = section;

  // If section fits in one chunk, return directly
  if (content.length <= cfg.maxSize) {
    chunks.push({
      content,
      startIndex,
      endIndex: startIndex + content.length,
      chunkIndex: startChunkIndex,
      title: title ?? undefined,
    });
    return chunks;
  }

  // Split by paragraphs and accumulate with overlap
  const paragraphs = splitByParagraphs(content);
  let currentChunk = '';
  let currentStartIndex = startIndex;
  let chunkIndex = startChunkIndex;

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed maxSize, save current chunk
    if (currentChunk.length > 0 && currentChunk.length + paragraph.length > cfg.maxSize) {
      const chunkContent = currentChunk.trim();
      chunks.push({
        content: chunkContent,
        startIndex: currentStartIndex,
        endIndex: currentStartIndex + chunkContent.length,
        chunkIndex: chunkIndex++,
        title: title ?? undefined,
      });

      // Start new chunk with overlap from the end of the previous chunk
      const overlap = getOverlapText(chunkContent, cfg.overlap);
      currentChunk = overlap;
      currentStartIndex = currentStartIndex + chunkContent.length - overlap.length;
    }

    currentChunk += paragraph + '\n\n';
  }

  // Save the last chunk
  if (currentChunk.length > 0) {
    const chunkContent = currentChunk.trim();
    chunks.push({
      content: chunkContent,
      startIndex: currentStartIndex,
      endIndex: currentStartIndex + chunkContent.length,
      chunkIndex,
      title: title ?? undefined,
    });
  }

  return chunks;
}

/**
 * Split text by double newlines (paragraph boundaries).
 */
export function splitByParagraphs(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Extract overlap text from the end of a chunk.
 * Tries to break at sentence boundaries (Chinese punctuation).
 */
export function getOverlapText(text: string, overlapSize: number): string {
  const size = Math.min(overlapSize, text.length);
  if (size <= 0) {
    return '';
  }

  const overlap = text.slice(text.length - size);

  // Try to break at a sentence boundary (Chinese sentence-ending punctuation)
  const lastPeriod = overlap.lastIndexOf('。'); // 。
  const lastQuestion = overlap.lastIndexOf('？'); // ？
  const lastExclamation = overlap.lastIndexOf('！'); // ！
  const lastSentenceEnd = Math.max(lastPeriod, lastQuestion, lastExclamation);

  if (lastSentenceEnd > size / 2) {
    return overlap.slice(lastSentenceEnd + 1).trim();
  }

  return overlap.trim();
}
