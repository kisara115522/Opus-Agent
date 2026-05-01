import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Simple JSON file-based persistence store.
 * Provides CRUD-like operations for typed objects stored in a JSON array file.
 *
 * @typeParam T - The type of objects stored. Must have an `id` string field.
 */
export class JsonFileStore<T extends { id: string }> {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Load all records from the JSON file.
   * Returns an empty array if the file does not exist.
   */
  async load(): Promise<T[]> {
    try {
      const raw = await readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as T[];
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return [];
      }
      throw err;
    }
  }

  /**
   * Save all records to the JSON file.
   * Creates parent directories if they don't exist.
   */
  async save(records: T[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(records, null, 2), 'utf-8');
  }

  /**
   * Get a single record by its ID, or null if not found.
   */
  async getById(id: string): Promise<T | null> {
    const records = await this.load();
    return records.find((r) => r.id === id) ?? null;
  }

  /**
   * Get the most recently added record (last in the array), or null if empty.
   */
  async getLatest(): Promise<T | null> {
    const records = await this.load();
    return records.length > 0 ? records[records.length - 1] : null;
  }

  /**
   * Append a record to the store. If a record with the same ID already exists,
   * it is replaced.
   */
  async upsert(record: T): Promise<void> {
    const records = await this.load();
    const idx = records.findIndex((r) => r.id === record.id);
    if (idx >= 0) {
      records[idx] = record;
    } else {
      records.push(record);
    }
    await this.save(records);
  }

  /**
   * Delete a record by ID. Returns true if a record was removed.
   */
  async delete(id: string): Promise<boolean> {
    const records = await this.load();
    const filtered = records.filter((r) => r.id !== id);
    if (filtered.length === records.length) {
      return false;
    }
    await this.save(filtered);
    return true;
  }
}
