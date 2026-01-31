/**
 * Hammerspoon HTTP API Module
 * Communicates with local Hammerspoon server to control Zoom status via UI automation
 * 
 * This provides the ability to set custom status messages, which the Zoom REST API doesn't support.
 */

import { backgroundLogger as logger } from '../utils/logger';

// ============================================
// Configuration
// ============================================

const HAMMERSPOON_PORT = 17394;
const HAMMERSPOON_BASE_URL = `http://localhost:${HAMMERSPOON_PORT}`;

// Timeout for HTTP requests (in milliseconds)
const REQUEST_TIMEOUT = 30000;

// ============================================
// Types
// ============================================

export interface HammerspoonResponse {
  success: boolean;
  message?: string;
  error?: string;
  status?: string;
}

export type HammerspoonErrorCode =
  | 'CONNECTION_REFUSED'  // Hammerspoon server not running
  | 'TIMEOUT'             // Request timed out
  | 'NETWORK_ERROR'       // Other network error
  | 'SERVER_ERROR'        // Server returned error
  | 'UNKNOWN';            // Unknown error

export class HammerspoonError extends Error {
  constructor(
    message: string,
    public readonly code: HammerspoonErrorCode
  ) {
    super(message);
    this.name = 'HammerspoonError';
  }
}

// ============================================
// Private: Request helpers
// ============================================

/**
 * Make a request to the Hammerspoon server
 */
async function makeRequest(
  method: 'GET' | 'POST',
  endpoint: string
): Promise<HammerspoonResponse> {
  const url = `${HAMMERSPOON_BASE_URL}${endpoint}`;
  logger.debug(`Hammerspoon request: ${method} ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const headers: Record<string, string> = {};
    
    // Hammerspoon's httpserver requires Content-Length for POST requests
    if (method === 'POST') {
      headers['Content-Length'] = '0';
    }

    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText }));
      throw new HammerspoonError(
        errorData.error || `HTTP ${response.status}`,
        'SERVER_ERROR'
      );
    }

    const data = await response.json() as HammerspoonResponse;
    logger.debug('Hammerspoon response:', data);
    return data;

  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof HammerspoonError) {
      throw error;
    }

    if (error instanceof Error) {
      // Check for specific error types
      if (error.name === 'AbortError') {
        throw new HammerspoonError('Request timed out', 'TIMEOUT');
      }
      
      if (error.message.includes('Failed to fetch') || 
          error.message.includes('ECONNREFUSED') ||
          error.message.includes('NetworkError')) {
        throw new HammerspoonError(
          'Hammerspoon server not running. Please ensure Hammerspoon is running.',
          'CONNECTION_REFUSED'
        );
      }

      throw new HammerspoonError(error.message, 'NETWORK_ERROR');
    }

    throw new HammerspoonError('Unknown error', 'UNKNOWN');
  }
}

// ============================================
// Public: API Functions
// ============================================

/**
 * Check if the Hammerspoon server is running and healthy
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await makeRequest('GET', '/health');
    return response.success === true;
  } catch (error) {
    logger.debug('Hammerspoon health check failed:', error);
    return false;
  }
}

/**
 * Get current Zoom status from Hammerspoon
 */
export async function getStatus(): Promise<string | null> {
  try {
    const response = await makeRequest('GET', '/status');
    if (response.success && response.status) {
      return response.status;
    }
    return null;
  } catch (error) {
    logger.warn('Failed to get Zoom status from Hammerspoon:', error);
    return null;
  }
}

/**
 * Set Zoom status to "In Meeting" (Busy + "In Google Meet" message)
 */
export async function setInMeeting(): Promise<void> {
  logger.info('Setting Zoom status via Hammerspoon: In Meeting');
  
  const response = await makeRequest('POST', '/meeting/join');
  
  if (!response.success) {
    throw new HammerspoonError(
      response.error || 'Failed to set meeting status',
      'SERVER_ERROR'
    );
  }
  
  logger.info('Hammerspoon: In Meeting status set successfully');
}

/**
 * Clear Zoom meeting status (Available + clear message)
 */
export async function clearMeeting(): Promise<void> {
  logger.info('Clearing Zoom status via Hammerspoon');
  
  const response = await makeRequest('POST', '/meeting/leave');
  
  if (!response.success) {
    throw new HammerspoonError(
      response.error || 'Failed to clear meeting status',
      'SERVER_ERROR'
    );
  }
  
  logger.info('Hammerspoon: Meeting status cleared successfully');
}

/**
 * Check if Hammerspoon integration is available
 * Returns true if the server is running and responsive
 */
export async function isAvailable(): Promise<boolean> {
  return await checkHealth();
}
