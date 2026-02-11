/**
 * Zoom Automator HTTP API Module
 * Communicates with the local Bun service that drives Zoom web automation.
 */

import { backgroundLogger as logger } from '../utils/logger';

const ZOOM_AUTOMATOR_PORT = 17394;
const ZOOM_AUTOMATOR_BASE_URL = `http://localhost:${ZOOM_AUTOMATOR_PORT}`;
const REQUEST_TIMEOUT = 30000;

export interface ZoomAutomatorResponse {
  success: boolean;
  message?: string;
  error?: string;
  status?: string;
}

export type ZoomAutomatorErrorCode =
  | 'CONNECTION_REFUSED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export class ZoomAutomatorError extends Error {
  constructor(
    message: string,
    public readonly code: ZoomAutomatorErrorCode
  ) {
    super(message);
    this.name = 'ZoomAutomatorError';
  }
}

async function makeRequest(
  method: 'GET' | 'POST',
  endpoint: string
): Promise<ZoomAutomatorResponse> {
  const url = `${ZOOM_AUTOMATOR_BASE_URL}${endpoint}`;
  logger.debug(`Zoom Automator request: ${method} ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const headers: Record<string, string> = {};
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
      const errorData = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      throw new ZoomAutomatorError(
        errorData.error || `HTTP ${response.status}`,
        'SERVER_ERROR'
      );
    }

    const data = (await response.json()) as ZoomAutomatorResponse;
    logger.debug('Zoom Automator response:', data);
    return data;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof ZoomAutomatorError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new ZoomAutomatorError('Request timed out', 'TIMEOUT');
      }

      if (
        error.message.includes('Failed to fetch') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('NetworkError')
      ) {
        throw new ZoomAutomatorError(
          'Zoom Automator is not running. Start the local Bun server.',
          'CONNECTION_REFUSED'
        );
      }

      throw new ZoomAutomatorError(error.message, 'NETWORK_ERROR');
    }

    throw new ZoomAutomatorError('Unknown error', 'UNKNOWN');
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const response = await makeRequest('GET', '/health');
    return response.success === true;
  } catch (error) {
    logger.debug('Zoom Automator health check failed:', error);
    return false;
  }
}

export async function getStatus(): Promise<string | null> {
  try {
    const response = await makeRequest('GET', '/status');
    if (response.success && response.status) {
      return response.status;
    }
    return null;
  } catch (error) {
    logger.warn('Failed to get Zoom status from Zoom Automator:', error);
    return null;
  }
}

export async function setInMeeting(): Promise<void> {
  logger.info('Setting Zoom status via Zoom Automator: In Meeting');
  const response = await makeRequest('POST', '/meeting/join');
  if (!response.success) {
    throw new ZoomAutomatorError(
      response.error || 'Failed to start automation meeting',
      'SERVER_ERROR'
    );
  }
}

export async function clearMeeting(): Promise<void> {
  logger.info('Clearing Zoom status via Zoom Automator');
  const response = await makeRequest('POST', '/meeting/leave');
  if (!response.success) {
    throw new ZoomAutomatorError(
      response.error || 'Failed to end automation meeting',
      'SERVER_ERROR'
    );
  }
}

export async function isAvailable(): Promise<boolean> {
  return checkHealth();
}
