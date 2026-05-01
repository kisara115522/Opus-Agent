/**
 * Unit tests for vector services:
 * - document-chunk.service.ts (chunkDocument)
 * - vector-embedding.service.ts (generateEmbedding)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentChunkConfig, EmbeddingConfig } from '../../src/config/stub.js';

// ---------------------------------------------------------------------------
// 1. Document Chunk Service Tests
// ---------------------------------------------------------------------------

import {
  chunkDocument,
  splitByHeadings,
  splitByParagraphs,
  getOverlapText,
} from '../../src/services/document-chunk.service.js';

const defaultChunkCfg: DocumentChunkConfig = { maxSize: 800, overlap: 100 };

describe('chunkDocument', () => {
  it('should return empty array for empty content', () => {
    expect(chunkDocument('', 'test.md', defaultChunkCfg)).toEqual([]);
  });

  it('should return empty array for whitespace-only content', () => {
    expect(chunkDocument('   \n\t  ', 'test.md', defaultChunkCfg)).toEqual([]);
  });

  it('should return a single chunk for small content', () => {
    const content = '# Title\nShort content that fits in one chunk';
    const chunks = chunkDocument(content, 'test.md', defaultChunkCfg);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Short content');
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].startIndex).toBe(0);
  });

  it('should produce multiple chunks for large content', () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `Paragraph ${i + 1}: ${'word '.repeat(60)}`,
    );
    const content = paragraphs.join('\n\n');
    const chunks = chunkDocument(content, 'test.txt', defaultChunkCfg);

    expect(chunks.length).toBeGreaterThan(1);
    // Verify sequential chunk indices
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  it('should maintain chunk overlap between consecutive chunks', () => {
    const paragraphs = Array.from(
      { length: 15 },
      (_, i) => `Paragraph ${i + 1} with content: ${'x'.repeat(100)}`,
    );
    const content = paragraphs.join('\n\n');
    const cfg: DocumentChunkConfig = { maxSize: 300, overlap: 50 };
    const chunks = chunkDocument(content, 'test.txt', cfg);

    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // The beginning of the second chunk should share some text with the end of the first
    const firstChunkTail = chunks[0].content.slice(-50);
    const secondChunkHead = chunks[1].content.slice(0, 50);
    // There must be some textual overlap
    const overlapFound = firstChunkTail.includes(secondChunkHead.slice(0, 20).trim());
    expect(overlapFound).toBe(true);
  });

  it('should preserve markdown heading titles in chunks', () => {
    const content = [
      '# Introduction',
      'A'.repeat(200),
      '# Methods',
      'B'.repeat(200),
      '# Results',
      'C'.repeat(200),
    ].join('\n\n');

    const chunks = chunkDocument(content, 'paper.md', defaultChunkCfg);

    expect(chunks.length).toBe(3);
    expect(chunks[0].title).toBe('Introduction');
    expect(chunks[1].title).toBe('Methods');
    expect(chunks[2].title).toBe('Results');
  });

  it('should preserve heading content inside the chunk body', () => {
    const content = '# My Section\nBody text here';
    const chunks = chunkDocument(content, 'test.md', defaultChunkCfg);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('# My Section');
    expect(chunks[0].content).toContain('Body text here');
  });

  it('should respect custom maxSize and overlap values', () => {
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `Para ${i}: ${'z'.repeat(50)}`,
    );
    const content = paragraphs.join('\n\n');
    const cfg: DocumentChunkConfig = { maxSize: 200, overlap: 30 };
    const chunks = chunkDocument(content, 'test.txt', cfg);

    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Vector Embedding Service Tests
// ---------------------------------------------------------------------------

// Mock the embedding client module
vi.mock('../../src/clients/embedding.client.js', () => ({
  generateEmbeddings: vi.fn(),
  generateQueryEmbedding: vi.fn(),
}));

import {
  generateEmbedding,
  generateEmbeddingBatch,
} from '../../src/services/vector-embedding.service.js';
import {
  generateEmbeddings,
  generateQueryEmbedding,
} from '../../src/clients/embedding.client.js';

const mockGenerateEmbeddings = vi.mocked(generateEmbeddings);
const mockGenerateQueryEmbedding = vi.mocked(generateQueryEmbedding);

const testEmbeddingCfg: EmbeddingConfig = {
  provider: 'openai',
  model: 'text-embedding-3-small',
  apiKey: 'test-key',
};

describe('generateEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a vector with the correct dimensions', async () => {
    const fakeVector = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    mockGenerateEmbeddings.mockResolvedValue([fakeVector]);

    const result = await generateEmbedding('Hello world', testEmbeddingCfg);

    expect(result).toHaveLength(1536);
    expect(result).toEqual(fakeVector);
    expect(mockGenerateEmbeddings).toHaveBeenCalledWith(['Hello world'], testEmbeddingCfg);
  });

  it('should throw on empty content', async () => {
    await expect(generateEmbedding('', testEmbeddingCfg)).rejects.toThrow(
      'Content cannot be empty',
    );
  });

  it('should throw on whitespace-only content', async () => {
    await expect(generateEmbedding('   ', testEmbeddingCfg)).rejects.toThrow(
      'Content cannot be empty',
    );
  });

  it('should throw when embedding API returns empty result', async () => {
    mockGenerateEmbeddings.mockResolvedValue([]);

    await expect(generateEmbedding('some text', testEmbeddingCfg)).rejects.toThrow(
      'Embedding API returned empty result',
    );
  });

  it('should propagate errors from the embedding client', async () => {
    mockGenerateEmbeddings.mockRejectedValue(new Error('Network failure'));

    await expect(generateEmbedding('some text', testEmbeddingCfg)).rejects.toThrow(
      'Network failure',
    );
  });
});

describe('generateEmbeddingBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array for empty input', async () => {
    const result = await generateEmbeddingBatch([], testEmbeddingCfg);

    expect(result).toEqual([]);
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  it('should return multiple vectors for batch input', async () => {
    const vec1 = [0.1, 0.2, 0.3];
    const vec2 = [0.4, 0.5, 0.6];
    mockGenerateEmbeddings.mockResolvedValue([vec1, vec2]);

    const result = await generateEmbeddingBatch(['text A', 'text B'], testEmbeddingCfg);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(vec1);
    expect(result[1]).toEqual(vec2);
    expect(mockGenerateEmbeddings).toHaveBeenCalledWith(['text A', 'text B'], testEmbeddingCfg);
  });
});
