/**
 * Zoom Presence Status API Module
 * Handles Zoom API calls for getting and updating presence status
 */

import { ZOOM_API } from '../config';
import type { ZoomPresenceStatus } from '../types';
import { getValidAccessToken, getAuthenticatedUserId } from './zoom-auth';
import { zoomApiLogger as logger } from '../utils/logger';

// ============================================
// Types
// ============================================

/**
 * Zoom API error codes for specific error handling
 */
export type ZoomApiErrorCode =
  | 'UNAUTHORIZED'      // 401 - token expired or invalid
  | 'RATE_LIMITED'      // 429 - too many requests
  | 'NOT_FOUND'         // 404 - user not found
  | 'FORBIDDEN'         // 403 - insufficient permissions
  | 'NETWORK_ERROR'     // Network/fetch error
  | 'INVALID_RESPONSE'  // Invalid response from API
  | 'NOT_AUTHENTICATED' // No valid auth token available
  | 'UNKNOWN';          // Unknown error

/**
 * Zoom API error class with error codes and retry info
 */
export class ZoomApiError extends Error {
  constructor(
    message: string,
    public readonly code: ZoomApiErrorCode,
    public readonly statusCode?: number,
    public readonly retryAfter?: number // seconds to wait before retry (for 429)
  ) {
    super(message);
    this.name = 'ZoomApiError';
  }

  /**
   * Check if this error is retryable
   */
  get isRetryable(): boolean {
    return this.code === 'RATE_LIMITED' || this.code === 'NETWORK_ERROR';
  }
}

/**
 * Presence status response from Zoom API
 */
export interface ZoomPresenceStatusResponse {
  status: ZoomPresenceStatus;
  duration?: number; // Duration in minutes for the status (DND only)
}

/**
 * User info from Zoom API /users/me
 */
export interface ZoomUserInfo {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
}

// ============================================
// Private: Request helpers
// ============================================

/**
 * Default retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
} as const;

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // Exponential backoff with jitter: delay = min(maxDelay, baseDelay * 2^attempt) + random jitter
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = Math.random() * 0.3 * cappedDelay; // 0-30% jitter
  return Math.floor(cappedDelay + jitter);
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse error response from Zoom API
 */
async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.message || data.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

/**
 * Map HTTP status code to ZoomApiErrorCode
 */
function mapStatusToErrorCode(status: number): ZoomApiErrorCode {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Make an authenticated request to Zoom API with retry logic
 */
async function makeApiRequest<T>(
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  endpoint: string,
  body?: object,
  options?: { maxRetries?: number }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? RETRY_CONFIG.maxRetries;
  let lastError: ZoomApiError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Get valid access token (will refresh if needed)
      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        throw new ZoomApiError('No valid access token available', 'NOT_AUTHENTICATED');
      }

      const url = `${ZOOM_API.baseUrl}${endpoint}`;
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      };

      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (body && (method === 'PUT' || method === 'POST')) {
        fetchOptions.body = JSON.stringify(body);
      }

      let response: Response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (fetchError) {
        throw new ZoomApiError(
          `Network error: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`,
          'NETWORK_ERROR'
        );
      }

      // Handle successful response
      if (response.ok) {
        // Handle 204 No Content (common for PUT requests)
        if (response.status === 204) {
          return {} as T;
        }
        return await response.json() as T;
      }

      // Handle error responses
      const errorMessage = await parseErrorResponse(response);
      const errorCode = mapStatusToErrorCode(response.status);

      // Extract retry-after header for rate limiting
      let retryAfter: number | undefined;
      if (response.status === 429) {
        const retryHeader = response.headers.get('Retry-After');
        retryAfter = retryHeader ? parseInt(retryHeader, 10) : undefined;
      }

      const apiError = new ZoomApiError(
        `Zoom API error (${response.status}): ${errorMessage}`,
        errorCode,
        response.status,
        retryAfter
      );

      // Don't retry 401 errors - they need token refresh which is handled by getValidAccessToken
      // Don't retry 403/404 - they won't succeed on retry
      if (!apiError.isRetryable) {
        throw apiError;
      }

      lastError = apiError;

    } catch (error) {
      if (error instanceof ZoomApiError) {
        if (!error.isRetryable || attempt === maxRetries) {
          throw error;
        }
        lastError = error;
      } else {
        // Wrap unknown errors
        throw new ZoomApiError(
          `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'UNKNOWN'
        );
      }
    }

    // Calculate delay before retry
    if (attempt < maxRetries && lastError) {
      let delayMs: number;

      if (lastError.code === 'RATE_LIMITED' && lastError.retryAfter) {
        // Use server-provided retry-after
        delayMs = lastError.retryAfter * 1000;
        logger.warn(`Rate limited, waiting ${lastError.retryAfter}s before retry ${attempt + 1}/${maxRetries}`);
      } else {
        // Use exponential backoff
        delayMs = calculateBackoffDelay(attempt, RETRY_CONFIG.baseDelayMs, RETRY_CONFIG.maxDelayMs);
        logger.debug(`Request failed, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      }

      await sleep(delayMs);
    }
  }

  // Should not reach here, but just in case
  throw lastError ?? new ZoomApiError('Max retries exceeded', 'UNKNOWN');
}

// ============================================
// Public: API Functions
// ============================================

/**
 * Get current user information from Zoom
 * Endpoint: GET /v2/users/me
 */
export async function getCurrentUser(): Promise<ZoomUserInfo> {
  logger.debug('Fetching current user info...');
  const user = await makeApiRequest<ZoomUserInfo>('GET', '/users/me');
  logger.info(`Current user: ${user.display_name} (${user.email})`);
  return user;
}

/**
 * Get current user's ID
 * Uses stored ID if available, otherwise fetches from API
 */
export async function getCurrentUserId(): Promise<string> {
  // Try to get stored user ID first
  const storedUserId = await getAuthenticatedUserId();
  if (storedUserId && storedUserId !== 'me') {
    return storedUserId;
  }

  // Fetch from API
  const user = await getCurrentUser();
  return user.id;
}

/**
 * Get current presence status for a user
 * Endpoint: GET /v2/users/{userId}/presence_status
 */
export async function getPresenceStatus(userId?: string): Promise<ZoomPresenceStatusResponse> {
  const id = userId ?? await getCurrentUserId();
  logger.debug(`Getting presence status for user: ${id}`);

  const response = await makeApiRequest<ZoomPresenceStatusResponse>('GET', `/users/${id}/presence_status`);
  logger.debug(`Current presence status: ${response.status}`);
  return response;
}

/**
 * Update presence status for a user
 * Endpoint: PUT /v2/users/{userId}/presence_status
 *
 * @param status - The status to set (Available, Away, Do_Not_Disturb)
 * @param duration - Duration in minutes (only for Do_Not_Disturb, 20-1440)
 * @param userId - User ID (defaults to current user)
 */
export async function updatePresenceStatus(
  status: ZoomPresenceStatus,
  duration?: number,
  userId?: string
): Promise<void> {
  const id = userId ?? await getCurrentUserId();
  logger.debug(`Updating presence status for user ${id} to: ${status}`);

  const body: { status: string; duration?: number } = { status };

  // Duration is only valid for Do_Not_Disturb
  if (status === 'Do_Not_Disturb' && duration !== undefined) {
    // Zoom API requires duration to be between 20 and 1440 minutes
    const clampedDuration = Math.max(20, Math.min(1440, duration));
    body.duration = clampedDuration;
  }

  await makeApiRequest<Record<string, never>>('PUT', `/users/${id}/presence_status`, body);
  logger.info(`Presence status updated to: ${status}`);
}

// ============================================
// Public: High-level Functions
// ============================================

// Storage key for previous status
const PREVIOUS_STATUS_KEY = 'previousPresenceStatus';

/**
 * Store previous status for later restoration
 */
async function savePreviousStatus(status: ZoomPresenceStatus): Promise<void> {
  await chrome.storage.local.set({ [PREVIOUS_STATUS_KEY]: status });
}

/**
 * Get previously saved status
 */
async function getPreviousStatus(): Promise<ZoomPresenceStatus | null> {
  const result = await chrome.storage.local.get(PREVIOUS_STATUS_KEY);
  return result[PREVIOUS_STATUS_KEY] ?? null;
}

/**
 * Clear previously saved status
 */
async function clearPreviousStatus(): Promise<void> {
  await chrome.storage.local.remove(PREVIOUS_STATUS_KEY);
}

/**
 * Set status to Do Not Disturb and save the previous status for restoration
 *
 * @param duration - Duration in minutes (20-1440, defaults to 60)
 * @returns The previous status that was saved
 */
export async function setDoNotDisturb(duration: number = 60): Promise<ZoomPresenceStatus> {
  logger.info('Setting Do Not Disturb mode...');

  // Get current status before changing
  const currentStatus = await getPresenceStatus();
  const previousStatus = currentStatus.status;

  // Only save previous status if not already DND
  if (previousStatus !== 'Do_Not_Disturb') {
    await savePreviousStatus(previousStatus);
    logger.debug(`Saved previous status: ${previousStatus}`);
  }

  // Set DND status
  await updatePresenceStatus('Do_Not_Disturb', duration);

  return previousStatus;
}

/**
 * Restore the previously saved status
 * If no previous status is saved, sets to Available
 *
 * @returns The status that was restored to
 */
export async function restorePreviousStatus(): Promise<ZoomPresenceStatus> {
  logger.info('Restoring previous status...');

  const previousStatus = await getPreviousStatus();
  const statusToRestore = previousStatus ?? 'Available';

  logger.debug(`Restoring to: ${statusToRestore}`);
  await updatePresenceStatus(statusToRestore);

  // Clear the saved status
  await clearPreviousStatus();

  return statusToRestore;
}

/**
 * Set status to Available
 */
export async function setAvailable(): Promise<void> {
  await updatePresenceStatus('Available');
}

/**
 * Set status to Away
 */
export async function setAway(): Promise<void> {
  await updatePresenceStatus('Away');
}
