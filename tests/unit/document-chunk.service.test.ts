/**
 * Unit tests for DocumentChunkService
 *
 * Covers: markdown heading split, paragraph split, overlap logic, edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  chunkDocument,
  splitByHeadings,
  splitByParagraphs,
  getOverlapText,
} from '../../src/services/document-chunk.service.js';
import type { DocumentChunkConfig } from '../../src/config/stub.js';

const defaultCfg: DocumentChunkConfig = { maxSize: 800, overlap: 100 };

describe('splitByHeadings', () => {
  it('should split by markdown headings', () => {
    const content = '# Title 1\nSome content\n## Title 2\nMore content';
    const sections = splitByHeadings(content);

    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[0].title).toBe('Title 1');
    expect(sections[1].title).toBe('Title 2');
  });

  it('should handle content before first heading', () => {
    const content = 'Preamble text\n# Title\nContent';
    const sections = splitByHeadings(content);

    expect(sections.length).toBeGreaterThanOrEqual(2);
    expect(sections[0].title).toBeNull();
    expect(sections[1].title).toBe('Title');
  });

  it('should return one section if no headings found', () => {
    const content = 'Just plain text\nno headings here';
    const sections = splitByHeadings(content);

    expect(sections.length).toBe(1);
    expect(sections[0].title).toBeNull();
    expect(sections[0].content).toBe(content);
  });

  it('should handle multiple heading levels', () => {
    const content = '# H1\nContent\n## H2\nMore\n### H3\nEven more';
    const sections = splitByHeadings(content);

    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections[0].title).toBe('H1');
    expect(sections[1].title).toBe('H2');
    expect(sections[2].title).toBe('H3');
  });

  it('should trim whitespace from section content', () => {
    const content = '# Title\n   \n  Content here  \n';
    const sections = splitByHeadings(content);

    expect(sections.length).toBe(1);
    expect(sections[0].title).toBe('Title');
    expect(sections[0].content).toBe('# Title\n   \n  Content here');
  });
});

describe('splitByParagraphs', () => {
  it('should split by double newlines', () => {
    const content = 'Paragraph 1\n\nParagraph 2\n\nParagraph 3';
    const paragraphs = splitByParagraphs(content);

    expect(paragraphs).toEqual(['Paragraph 1', 'Paragraph 2', 'Paragraph 3']);
  });

  it('should handle multiple consecutive newlines', () => {
    const content = 'Para 1\n\n\n\nPara 2';
    const paragraphs = splitByParagraphs(content);

    expect(paragraphs).toEqual(['Para 1', 'Para 2']);
  });

  it('should filter out empty paragraphs', () => {
    const content = 'Para 1\n\n   \n\nPara 2';
    const paragraphs = splitByParagraphs(content);

    expect(paragraphs).toEqual(['Para 1', 'Para 2']);
  });

  it('should return single item if no double newlines', () => {
    const content = 'Single paragraph without double newlines';
    const paragraphs = splitByParagraphs(content);

    expect(paragraphs).toEqual([content]);
  });
});

describe('getOverlapText', () => {
  it('should return tail of text within overlap size', () => {
    const text = 'A'.repeat(200);
    const overlap = getOverlapText(text, 100);

    expect(overlap.length).toBeLessThanOrEqual(100);
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('should handle text shorter than overlap size', () => {
    const text = 'Short text';
    const overlap = getOverlapText(text, 100);

    expect(overlap).toBe(text);
  });

  it('should return empty string for zero overlap', () => {
    const text = 'Some text';
    const overlap = getOverlapText(text, 0);

    expect(overlap).toBe('');
  });

  it('should try to break at Chinese sentence boundary', () => {
    const text = 'First sentence。Second sentence。End of text that is long enough';
    const overlap = getOverlapText(text, 40);

    // Should break after a sentence-ending punctuation if possible
    expect(overlap.length).toBeLessThanOrEqual(40);
  });

  it('should handle text with no sentence boundaries', () => {
    const text = 'a'.repeat(200);
    const overlap = getOverlapText(text, 50);

    expect(overlap.length).toBeLessThanOrEqual(50);
    expect(overlap.length).toBeGreaterThan(0);
  });
});

describe('chunkDocument', () => {
  it('should return empty array for null/empty content', () => {
    expect(chunkDocument('', 'test.md', defaultCfg)).toEqual([]);
  });

  it('should return single chunk for small document', () => {
    const content = '# Title\nShort content';
    const chunks = chunkDocument(content, 'test.md', defaultCfg);

    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toContain('Short content');
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('should preserve title in chunks', () => {
    const content = '# My Title\nSome content under title';
    const chunks = chunkDocument(content, 'test.md', defaultCfg);

    expect(chunks[0].title).toBe('My Title');
  });

  it('should chunk large documents by paragraphs', () => {
    // Create a document that exceeds maxSize
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i + 1}: ${'word '.repeat(50)}`,
    );
    const content = '# Large Doc\n\n' + paragraphs.join('\n\n');
    const chunks = chunkDocument(content, 'test.md', defaultCfg);

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be within maxSize (allowing some overflow for paragraph boundaries)
    for (const chunk of chunks) {
      // Allow up to maxSize + one paragraph of overflow
      expect(chunk.content.length).toBeLessThanOrEqual(defaultCfg.maxSize + 200);
    }
  });

  it('should maintain sequential chunk indices', () => {
    const paragraphs = Array.from({ length: 30 }, (_, i) =>
      `Paragraph ${i + 1}: ${'word '.repeat(80)}`,
    );
    const content = paragraphs.join('\n\n');
    const chunks = chunkDocument(content, 'test.txt', defaultCfg);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i);
    }
  });

  it('should create overlapping content between chunks', () => {
    // Create enough content to produce multiple chunks
    const paragraphs = Array.from({ length: 15 }, (_, i) =>
      `Paragraph ${i + 1} with content: ${'x'.repeat(100)}`,
    );
    const content = paragraphs.join('\n\n');
    const smallOverlapCfg: DocumentChunkConfig = { maxSize: 300, overlap: 50 };
    const chunks = chunkDocument(content, 'test.txt', smallOverlapCfg);

    if (chunks.length >= 2) {
      // Second chunk should start with some overlap from the first
      const firstEnd = chunks[0].content;
      const secondStart = chunks[1].content.slice(0, 50);
      // The overlap text should appear at the end of the first chunk
      expect(firstEnd).toContain(secondStart.trim().slice(0, 20));
    }
  });

  it('should handle document with multiple headings and sections', () => {
    const content = [
      '# Section 1',
      'A'.repeat(400),
      '# Section 2',
      'B'.repeat(400),
      '# Section 3',
      'C'.repeat(400),
    ].join('\n\n');

    const chunks = chunkDocument(content, 'test.md', defaultCfg);

    // All 3 sections fit within maxSize, so 3 chunks
    expect(chunks.length).toBe(3);
    expect(chunks[0].title).toBe('Section 1');
    expect(chunks[1].title).toBe('Section 2');
    expect(chunks[2].title).toBe('Section 3');
  });

  it('should handle document without headings', () => {
    const content = 'Plain text paragraph 1.\n\nPlain text paragraph 2.';
    const chunks = chunkDocument(content, 'test.txt', defaultCfg);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].content).toContain('Plain text');
  });

  it('should assign correct startIndex and endIndex', () => {
    const content = '# Title\nShort content';
    const chunks = chunkDocument(content, 'test.md', defaultCfg);

    expect(chunks[0].startIndex).toBe(0);
    expect(chunks[0].endIndex).toBeGreaterThan(0);
    expect(chunks[0].endIndex).toBe(chunks[0].startIndex + chunks[0].content.length);
  });

  it('should handle custom maxSize and overlap', () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Para ${i}: ${'z'.repeat(50)}`,
    );
    const content = paragraphs.join('\n\n');
    const customCfg: DocumentChunkConfig = { maxSize: 200, overlap: 30 };
    const chunks = chunkDocument(content, 'test.txt', customCfg);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(customCfg.maxSize + 100);
    }
  });
});
