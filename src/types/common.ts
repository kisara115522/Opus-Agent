/**
 * Common response wrapper, matching Java CommonResponse<T>.
 * All API responses are wrapped in this envelope.
 */
export interface CommonResponse<T> {
  /** Response code (200 for success, 500 for error) */
  code: number;
  /** Response message */
  message: string;
  /** Response payload */
  data: T | null;
}

/**
 * Create a success response with the given data.
 */
export function successResponse<T>(data: T): CommonResponse<T> {
  return { code: 200, message: 'success', data };
}

/**
 * Create an error response with the given message and optional code.
 */
export function errorResponse<T = null>(
  message: string,
  code: number = 500,
): CommonResponse<T> {
  return { code, message, data: null as T };
}

/**
 * Alias matching ChatController.ApiResponse<T> - same shape as CommonResponse.
 */
export type ApiResponse<T> = CommonResponse<T>;
