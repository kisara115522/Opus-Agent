/**
 * Truncate a string to the given maximum length, appending '...' if truncated.
 * Returns the original string if it is shorter than maxLength.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}

/**
 * Check whether a string is null, undefined, empty, or whitespace-only.
 */
export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim().length === 0;
}

/**
 * Check whether a source string contains any of the given keywords.
 * Matching is case-insensitive.
 */
export function containsAny(source: string, ...keywords: string[]): boolean {
  const lower = source.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

/**
 * Safely convert a string to lowercase.
 * Returns empty string for null or undefined.
 */
export function safeLower(value: string | null | undefined): string {
  return value ? value.toLowerCase() : '';
}
