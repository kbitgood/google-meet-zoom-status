/**
 * Zoom OAuth Authentication Module
 * Handles OAuth 2.0 flow using Chrome's identity API
 */

import { ZOOM_CONFIG, ZOOM_API, ZOOM_SCOPES } from '../config';
import type { ZoomTokenData } from '../types';
import { getZoomToken, saveZoomToken, removeZoomToken, shouldRefreshZoomToken } from '../utils/storage';
import { zoomAuthLogger as logger } from '../utils/logger';

// Token refresh timer ID
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * OAuth error types for specific error handling
 */
export class ZoomAuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'USER_CANCELLED' | 'NETWORK_ERROR' | 'TOKEN_ERROR' | 'INVALID_RESPONSE' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'ZoomAuthError';
  }
}

/**
 * Build the OAuth authorization URL with all required parameters
 */
function buildAuthorizationUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ZOOM_CONFIG.clientId,
    redirect_uri: ZOOM_CONFIG.redirectUri,
    scope: ZOOM_SCOPES.join(' '),
  });

  return `${ZOOM_API.authUrl}?${params.toString()}`;
}

/**
 * Extract the authorization code from the callback URL
 */
function extractAuthorizationCode(callbackUrl: string): string {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    const errorDescription = url.searchParams.get('error_description') || error;
    throw new ZoomAuthError(
      `OAuth error: ${errorDescription}`,
      error === 'access_denied' ? 'USER_CANCELLED' : 'INVALID_RESPONSE'
    );
  }

  if (!code) {
    throw new ZoomAuthError('No authorization code in callback URL', 'INVALID_RESPONSE');
  }

  return code;
}

/**
 * Exchange authorization code for access and refresh tokens
 */
async function exchangeCodeForTokens(authorizationCode: string): Promise<ZoomTokenData> {
  const credentials = btoa(`${ZOOM_CONFIG.clientId}:${ZOOM_CONFIG.clientSecret}`);

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: ZOOM_CONFIG.redirectUri,
  });

  let response: Response;
  try {
    response = await fetch(ZOOM_API.tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (error) {
    throw new ZoomAuthError(
      `Network error during token exchange: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'NETWORK_ERROR'
    );
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ZoomAuthError(
      `Token exchange failed: ${errorData.error || response.statusText}`,
      'TOKEN_ERROR'
    );
  }

  const data = await response.json();

  // Calculate expiry timestamp (Zoom tokens expire in 1 hour = 3600 seconds)
  const expiresInMs = (data.expires_in || 3600) * 1000;
  const expiresAt = Date.now() + expiresInMs;

  // Get user ID from token response or fetch from /users/me
  let userId = data.user_id;
  if (!userId) {
    userId = await fetchUserId(data.access_token);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    userId,
  };
}

/**
 * Fetch the current user's ID from Zoom API
 */
async function fetchUserId(accessToken: string): Promise<string> {
  try {
    const response = await fetch(`${ZOOM_API.baseUrl}/users/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      logger.error(`Failed to fetch user ID: ${response.status}`);
      return 'me'; // Fallback to 'me' which works for most Zoom API calls
    }

    const data = await response.json();
    return data.id || 'me';
  } catch (error) {
    logger.error('Error fetching user ID', { error });
    return 'me';
  }
}

/**
 * Refresh the access token using the refresh token
 */
async function refreshAccessToken(refreshToken: string): Promise<ZoomTokenData> {
  const credentials = btoa(`${ZOOM_CONFIG.clientId}:${ZOOM_CONFIG.clientSecret}`);

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  let response: Response;
  try {
    response = await fetch(ZOOM_API.tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
  } catch (error) {
    throw new ZoomAuthError(
      `Network error during token refresh: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'NETWORK_ERROR'
    );
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ZoomAuthError(
      `Token refresh failed: ${errorData.error || response.statusText}`,
      'TOKEN_ERROR'
    );
  }

  const data = await response.json();

  // Calculate expiry timestamp
  const expiresInMs = (data.expires_in || 3600) * 1000;
  const expiresAt = Date.now() + expiresInMs;

  // Get user ID from response or fetch it
  let userId = data.user_id;
  if (!userId) {
    userId = await fetchUserId(data.access_token);
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    userId,
  };
}

/**
 * Schedule token refresh before expiry
 * Refreshes 5 minutes before the token expires
 */
function scheduleTokenRefresh(tokenData: ZoomTokenData): void {
  // Clear any existing timer
  if (refreshTimerId) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }

  // Calculate time until we should refresh (5 minutes before expiry)
  const refreshBufferMs = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  const timeUntilRefresh = tokenData.expiresAt - now - refreshBufferMs;

  if (timeUntilRefresh <= 0) {
    // Token is already due for refresh, do it now
    logger.info('Token needs immediate refresh');
    performTokenRefresh().catch((err) => logger.error('Immediate token refresh failed', { error: err }));
    return;
  }

  logger.info(`Scheduling token refresh in ${Math.round(timeUntilRefresh / 1000 / 60)} minutes`);

  refreshTimerId = setTimeout(async () => {
    try {
      await performTokenRefresh();
    } catch (error) {
      logger.error('Scheduled token refresh failed', { error });
    }
  }, timeUntilRefresh);
}

/**
 * Perform token refresh and update storage
 */
async function performTokenRefresh(): Promise<ZoomTokenData | null> {
  const currentToken = await getZoomToken();
  if (!currentToken) {
    logger.debug('No token to refresh');
    return null;
  }

  logger.info('Refreshing access token...');

  try {
    const newTokenData = await refreshAccessToken(currentToken.refreshToken);
    await saveZoomToken(newTokenData);
    scheduleTokenRefresh(newTokenData);
    logger.info('Token refreshed successfully');
    return newTokenData;
  } catch (error) {
    logger.error('Token refresh failed', { error });
    // If refresh fails with a token error, the refresh token may be invalid
    // We should clear the tokens and require re-authentication
    if (error instanceof ZoomAuthError && error.code === 'TOKEN_ERROR') {
      logger.info('Clearing invalid tokens');
      await removeZoomToken();
    }
    throw error;
  }
}

/**
 * Initiate the OAuth flow using Chrome's launchWebAuthFlow
 * This opens a popup window for the user to authorize the app
 */
export async function initiateOAuthFlow(): Promise<ZoomTokenData> {
  logger.info('Initiating OAuth flow...');

  const authUrl = buildAuthorizationUrl();

  let callbackUrl: string;
  try {
    // launchWebAuthFlow handles the OAuth popup
    const result = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });

    if (!result) {
      throw new ZoomAuthError('No callback URL received', 'USER_CANCELLED');
    }

    callbackUrl = result;
  } catch (error) {
    // Chrome returns specific error messages for user cancellation
    if (error instanceof Error) {
      if (error.message.includes('canceled') || error.message.includes('cancelled')) {
        throw new ZoomAuthError('User cancelled the OAuth flow', 'USER_CANCELLED');
      }
      if (error.message.includes('network')) {
        throw new ZoomAuthError(`Network error: ${error.message}`, 'NETWORK_ERROR');
      }
    }
    throw new ZoomAuthError(
      `OAuth flow error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'UNKNOWN'
    );
  }

  logger.debug('Got callback URL, extracting authorization code...');

  // Extract the authorization code from the callback
  const authorizationCode = extractAuthorizationCode(callbackUrl);

  logger.debug('Exchanging authorization code for tokens...');

  // Exchange the code for tokens
  const tokenData = await exchangeCodeForTokens(authorizationCode);

  // Save tokens to storage
  await saveZoomToken(tokenData);

  // Schedule automatic refresh
  scheduleTokenRefresh(tokenData);

  logger.info('OAuth flow completed successfully');

  return tokenData;
}

/**
 * Disconnect from Zoom (logout)
 * Clears stored tokens and cancels scheduled refresh
 */
export async function disconnect(): Promise<void> {
  logger.info('Disconnecting from Zoom...');

  // Cancel any scheduled token refresh
  if (refreshTimerId) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }

  // Remove stored tokens
  await removeZoomToken();

  logger.info('Disconnected from Zoom');
}

/**
 * Get a valid access token, refreshing if necessary
 * Returns null if not authenticated
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokenData = await getZoomToken();
  if (!tokenData) {
    return null;
  }

  // Check if we need to refresh
  if (await shouldRefreshZoomToken()) {
    try {
      const newTokenData = await performTokenRefresh();
      return newTokenData?.accessToken ?? null;
    } catch (error) {
      logger.error('Failed to refresh token', { error });
      return null;
    }
  }

  return tokenData.accessToken;
}

/**
 * Check if the user is authenticated (has valid tokens)
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await getValidAccessToken();
  return token !== null;
}

/**
 * Get the authenticated user's ID
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const tokenData = await getZoomToken();
  return tokenData?.userId ?? null;
}

/**
 * Initialize auth module on service worker startup
 * Restores refresh timer if tokens exist
 */
export async function initializeAuth(): Promise<void> {
  logger.info('Initializing auth module...');

  const tokenData = await getZoomToken();
  if (tokenData) {
    logger.debug('Found existing tokens, checking validity...');

    // Check if token is expired
    if (tokenData.expiresAt <= Date.now()) {
      logger.info('Token expired, attempting refresh...');
      try {
        await performTokenRefresh();
      } catch (error) {
        logger.error('Failed to refresh expired token', { error });
        await removeZoomToken();
      }
    } else {
      // Schedule refresh for valid token
      scheduleTokenRefresh(tokenData);
    }
  } else {
    logger.debug('No existing tokens found');
  }
}
