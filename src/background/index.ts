/**
 * Background service worker entry point
 * Handles Zoom API calls, OAuth, and state management
 */

import type { ExtensionMessage, MeetingStateResponse, AuthStatusResponse, AuthOperationResponse } from '../types';
import {
  initiateOAuthFlow,
  disconnect,
  isAuthenticated,
  getAuthenticatedUserId,
  initializeAuth,
  ZoomAuthError,
} from './zoom-auth';

console.log('[Background] Service worker started');

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  // Handle async operations
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error('[Background] Message handling error:', error);
      sendResponse({ success: false, error: error.message });
    });

  // Return true to indicate async response
  return true;
});

/**
 * Handle messages asynchronously
 */
async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'MEETING_JOINED':
      console.log('[Background] Meeting joined:', message.meetingId);
      // TODO: Update Zoom status to Do_Not_Disturb
      return { success: true };

    case 'MEETING_LEFT':
      console.log('[Background] Meeting left');
      // TODO: Update Zoom status to Available
      return { success: true };

    case 'GET_MEETING_STATE':
      // TODO: Return actual meeting state from storage
      const stateResponse: MeetingStateResponse = {
        isInMeeting: false,
      };
      return stateResponse;

    case 'GET_AUTH_STATUS':
      return await handleGetAuthStatus();

    case 'CONNECT_ZOOM':
      return await handleConnectZoom();

    case 'DISCONNECT_ZOOM':
      return await handleDisconnectZoom();

    default:
      console.warn('[Background] Unknown message type:', message);
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * Handle GET_AUTH_STATUS message
 */
async function handleGetAuthStatus(): Promise<AuthStatusResponse> {
  const authenticated = await isAuthenticated();
  const userId = authenticated ? await getAuthenticatedUserId() : undefined;

  return {
    isAuthenticated: authenticated,
    userId: userId ?? undefined,
  };
}

/**
 * Handle CONNECT_ZOOM message - initiates OAuth flow
 */
async function handleConnectZoom(): Promise<AuthOperationResponse> {
  try {
    console.log('[Background] Starting Zoom OAuth flow...');
    const tokenData = await initiateOAuthFlow();
    console.log('[Background] Zoom OAuth successful, user:', tokenData.userId);

    return {
      success: true,
    };
  } catch (error) {
    console.error('[Background] Zoom OAuth failed:', error);

    if (error instanceof ZoomAuthError) {
      return {
        success: false,
        error: error.message,
        errorCode: error.code,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'UNKNOWN',
    };
  }
}

/**
 * Handle DISCONNECT_ZOOM message - clears stored tokens
 */
async function handleDisconnectZoom(): Promise<AuthOperationResponse> {
  try {
    console.log('[Background] Disconnecting from Zoom...');
    await disconnect();
    console.log('[Background] Disconnected from Zoom');

    return {
      success: true,
    };
  } catch (error) {
    console.error('[Background] Zoom disconnect failed:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'UNKNOWN',
    };
  }
}

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason);
  // Initialize auth module after installation
  initializeAuth().catch(console.error);
});

// Handle service worker startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Service worker started up');
  // Initialize auth module on startup (restore refresh timer)
  initializeAuth().catch(console.error);
});

// Initialize auth immediately in case service worker is starting fresh
initializeAuth().catch(console.error);
