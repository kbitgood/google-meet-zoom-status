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
import {
  setDoNotDisturb,
  restorePreviousStatus,
  ZoomApiError,
} from './zoom-api';
import {
  addMeetingTab,
  removeMeetingTab,
  hasActiveMeetings,
  getActiveMeetingCount,
  initializeMeetingState,
  getActiveMeetingTabs,
  isInMeetingMode,
} from './meeting-state';
import { backgroundLogger as logger } from '../utils/logger';
import {
  notifyApiError,
  notifyAuthExpired,
  notifyNetworkError,
  initializeNotificationListeners,
  onNotificationButtonClick,
  saveErrorState,
  clearErrorState,
} from '../utils/notifications';

logger.info('Service worker started');

// ============================================
// Badge Management
// ============================================

type BadgeState = 'disconnected' | 'connected' | 'in_meeting';

const BADGE_COLORS: Record<BadgeState, string> = {
  disconnected: '#808080', // Gray
  connected: '#22C55E',    // Green
  in_meeting: '#EF4444',   // Red
};

const BADGE_TEXT: Record<BadgeState, string> = {
  disconnected: '',
  connected: '',
  in_meeting: 'MTG',
};

/**
 * Update the extension badge to reflect current state
 */
async function updateBadge(): Promise<void> {
  let state: BadgeState = 'disconnected';

  const authenticated = await isAuthenticated();
  if (authenticated) {
    const inMeeting = await hasActiveMeetings();
    state = inMeeting ? 'in_meeting' : 'connected';
  }

  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[state] });
  await chrome.action.setBadgeText({ text: BADGE_TEXT[state] });

  logger.debug(`Badge updated to: ${state}`);
}

// ============================================
// Error Handling Helpers
// ============================================

/**
 * Handle Zoom API errors with notifications and graceful degradation
 */
async function handleZoomApiError(error: unknown, context: string): Promise<void> {
  if (error instanceof ZoomApiError) {
    logger.error(`${context}: ${error.message}`, { 
      code: error.code, 
      statusCode: error.statusCode,
      retryAfter: error.retryAfter 
    });

    // Handle specific error codes
    switch (error.code) {
      case 'UNAUTHORIZED':
      case 'NOT_AUTHENTICATED':
        // Auth has expired, notify user
        await saveErrorState('auth_expired', 'Your Zoom session has expired. Please reconnect.');
        await notifyAuthExpired();
        break;
      
      case 'NETWORK_ERROR':
        await saveErrorState('network_error', 'Unable to connect to Zoom. Check your internet connection.');
        await notifyNetworkError();
        break;
      
      case 'RATE_LIMITED':
        // Don't notify for rate limiting - it will retry automatically
        logger.warn('Rate limited by Zoom API, will retry');
        break;
      
      case 'FORBIDDEN':
        await saveErrorState('api_error', 'Zoom permissions error. You may need to reconnect.');
        await notifyApiError('Permission denied. Please reconnect to Zoom.');
        break;
      
      default:
        await saveErrorState('api_error', error.message);
        await notifyApiError(error.message);
    }
  } else if (error instanceof ZoomAuthError) {
    logger.error(`${context}: Auth error - ${error.message}`, { code: error.code });
    
    if (error.code === 'TOKEN_ERROR') {
      await saveErrorState('auth_expired', 'Your Zoom session has expired. Please reconnect.');
      await notifyAuthExpired();
    } else if (error.code === 'NETWORK_ERROR') {
      await saveErrorState('network_error', 'Unable to connect to Zoom.');
      await notifyNetworkError();
    }
  } else {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`${context}: ${message}`, { error });
    await saveErrorState('api_error', message);
    await notifyApiError(message);
  }
}

// ============================================
// Meeting Event Handlers
// ============================================

/**
 * Handle when a user joins a meeting
 */
async function handleMeetingJoined(tabId: number, meetingId?: string): Promise<{ success: boolean; error?: string }> {
  logger.info(`Processing MEETING_JOINED for tab ${tabId}`, { meetingId });

  const isFirstMeeting = await addMeetingTab(tabId, meetingId);

  // Update badge immediately
  await updateBadge();

  // Only update Zoom status if this is the first meeting
  if (!isFirstMeeting) {
    logger.debug('Already in a meeting, skipping Zoom status update');
    return { success: true };
  }

  // Check if authenticated before trying to update status
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    logger.debug('Not authenticated, skipping Zoom status update');
    return { success: true };
  }

  try {
    // Set Zoom status to Do Not Disturb
    // Use 240 minutes (4 hours) as a reasonable meeting duration
    const previousStatus = await setDoNotDisturb(240);
    logger.info(`Zoom status changed to Do_Not_Disturb (was: ${previousStatus})`);

    // Clear any previous error state on success
    await clearErrorState();

    return { success: true };
  } catch (error) {
    await handleZoomApiError(error, 'Failed to update Zoom status');

    if (error instanceof ZoomApiError) {
      return {
        success: false,
        error: `Zoom API error: ${error.message}`,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Handle when a user leaves a meeting
 */
async function handleMeetingLeft(tabId: number): Promise<{ success: boolean; error?: string }> {
  logger.info(`Processing MEETING_LEFT for tab ${tabId}`);

  const wasLastMeeting = await removeMeetingTab(tabId);

  // Update badge immediately
  await updateBadge();

  // Only restore Zoom status if this was the last meeting
  if (!wasLastMeeting) {
    const count = await getActiveMeetingCount();
    logger.debug(`Still in ${count} meeting(s), skipping Zoom status restore`);
    return { success: true };
  }

  // Check if authenticated before trying to restore status
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    logger.debug('Not authenticated, skipping Zoom status restore');
    return { success: true };
  }

  try {
    // Restore previous Zoom status
    const restoredStatus = await restorePreviousStatus();
    logger.info(`Zoom status restored to: ${restoredStatus}`);

    // Clear any previous error state on success
    await clearErrorState();

    return { success: true };
  } catch (error) {
    await handleZoomApiError(error, 'Failed to restore Zoom status');

    if (error instanceof ZoomApiError) {
      return {
        success: false,
        error: `Zoom API error: ${error.message}`,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================
// Tab Event Handlers
// ============================================

/**
 * Handle tab close - treat as meeting left
 */
async function handleTabClosed(tabId: number): Promise<void> {
  logger.debug(`Tab ${tabId} closed`);

  // Remove the tab and update status if needed
  const wasLastMeeting = await removeMeetingTab(tabId);

  if (wasLastMeeting) {
    logger.info('Last meeting tab closed, restoring Zoom status');

    // Update badge
    await updateBadge();

    // Restore status if authenticated
    const authenticated = await isAuthenticated();
    if (authenticated) {
      try {
        const restoredStatus = await restorePreviousStatus();
        logger.info(`Zoom status restored to: ${restoredStatus}`);
        await clearErrorState();
      } catch (error) {
        await handleZoomApiError(error, 'Failed to restore Zoom status on tab close');
      }
    }
  }
}

/**
 * Handle tab URL change - if navigating away from Meet, treat as meeting left
 */
async function handleTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): Promise<void> {
  // Only care about URL changes
  if (!changeInfo.url) {
    return;
  }

  // Check if this specific tab was in a meeting
  const meetingTabs = await getActiveMeetingTabs();
  const tabWasInMeeting = meetingTabs.some(tab => tab.tabId === tabId);
  if (!tabWasInMeeting) {
    return;
  }

  // Check if the new URL is still a Meet page
  if (!changeInfo.url.includes('meet.google.com')) {
    logger.info(`Tab ${tabId} navigated away from Meet`);
    await handleMeetingLeft(tabId);
  }
}

/**
 * Handle window close - check if any meeting tabs were in that window
 */
async function handleWindowClosed(windowId: number): Promise<void> {
  logger.debug(`Window ${windowId} closed`);

  // Get all active meeting tabs
  const meetingTabs = await getActiveMeetingTabs();
  if (meetingTabs.length === 0) {
    return;
  }

  // Find tabs that were in the closed window (they will no longer exist)
  // Since the window is closed, we can't query which tabs were in it
  // Instead, we'll verify which tracked tabs still exist
  const tabsToRemove: number[] = [];

  for (const tab of meetingTabs) {
    try {
      await chrome.tabs.get(tab.tabId);
      // Tab still exists, it wasn't in the closed window
    } catch {
      // Tab doesn't exist anymore, was in the closed window
      tabsToRemove.push(tab.tabId);
    }
  }

  if (tabsToRemove.length === 0) {
    return;
  }

  logger.info(`Found ${tabsToRemove.length} meeting tab(s) in closed window`);

  // Process each closed tab
  for (const tabId of tabsToRemove) {
    await handleMeetingLeft(tabId);
  }
}

/**
 * Handle browser restart/crash recovery
 * Called during initialization if there were stale meeting tabs
 */
async function handleCrashRecovery(staleTabCount: number): Promise<void> {
  if (staleTabCount === 0) {
    return;
  }

  logger.warn(`Browser crash recovery: ${staleTabCount} stale tabs detected`);

  // Check if we were in meeting mode (status was changed)
  const inMeetingMode = await isInMeetingMode();
  if (!inMeetingMode) {
    logger.debug('No active meeting mode, skipping status restoration');
    return;
  }

  // Check if there are any remaining active meetings after cleanup
  const hasRemaining = await hasActiveMeetings();
  if (hasRemaining) {
    logger.debug('Still have active meetings, keeping current status');
    return;
  }

  // No active meetings left, restore Zoom status
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    logger.debug('Not authenticated, skipping status restoration');
    return;
  }

  try {
    logger.info('Restoring Zoom status after crash recovery');
    const restoredStatus = await restorePreviousStatus();
    logger.info(`Zoom status restored to: ${restoredStatus}`);
    await clearErrorState();
  } catch (error) {
    await handleZoomApiError(error, 'Failed to restore Zoom status after crash');
  }
}

// ============================================
// Message Handler
// ============================================

/**
 * Handle messages asynchronously
 */
async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  // Get tab ID from sender if available
  const tabId = sender.tab?.id ?? 0;

  switch (message.type) {
    case 'MEETING_JOINED':
      return handleMeetingJoined(message.tabId || tabId, message.meetingId);

    case 'MEETING_LEFT':
      return handleMeetingLeft(message.tabId || tabId);

    case 'GET_MEETING_STATE':
      const inMeeting = await hasActiveMeetings();
      const meetingCount = await getActiveMeetingCount();
      const stateResponse: MeetingStateResponse = {
        isInMeeting: inMeeting,
        meetingId: meetingCount > 0 ? `${meetingCount} active` : undefined,
      };
      return stateResponse;

    case 'GET_AUTH_STATUS':
      return await handleGetAuthStatus();

    case 'CONNECT_ZOOM':
      return await handleConnectZoom();

    case 'DISCONNECT_ZOOM':
      return await handleDisconnectZoom();

    default:
      logger.warn('Unknown message type:', message);
      return { success: false, error: 'Unknown message type' };
  }
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  // Handle async operations
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      logger.error('Message handling error', error);
      sendResponse({ success: false, error: error.message });
    });

  // Return true to indicate async response
  return true;
});

// ============================================
// Auth Handlers
// ============================================

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
    logger.info('Starting Zoom OAuth flow...');
    const tokenData = await initiateOAuthFlow();
    logger.info(`Zoom OAuth successful, user: ${tokenData.userId}`);

    // Update badge after successful connection
    await updateBadge();

    // Clear any previous error state
    await clearErrorState();

    return {
      success: true,
    };
  } catch (error) {
    logger.error('Zoom OAuth failed', error);

    if (error instanceof ZoomAuthError) {
      // Don't save error state for user cancellation
      if (error.code !== 'USER_CANCELLED') {
        await saveErrorState('auth_expired', error.message);
      }

      return {
        success: false,
        error: error.message,
        errorCode: error.code,
      };
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    await saveErrorState('api_error', message);

    return {
      success: false,
      error: message,
      errorCode: 'UNKNOWN',
    };
  }
}

/**
 * Handle DISCONNECT_ZOOM message - clears stored tokens
 */
async function handleDisconnectZoom(): Promise<AuthOperationResponse> {
  try {
    logger.info('Disconnecting from Zoom...');
    await disconnect();
    logger.info('Disconnected from Zoom');

    // Update badge after disconnect
    await updateBadge();

    // Clear any previous error state
    await clearErrorState();

    return {
      success: true,
    };
  } catch (error) {
    logger.error('Zoom disconnect failed', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorCode: 'UNKNOWN',
    };
  }
}

// ============================================
// Notification Button Handler
// ============================================

/**
 * Handle notification button clicks (e.g., "Reconnect")
 */
function setupNotificationHandler(): void {
  onNotificationButtonClick(async (action) => {
    if (action === 'reconnect') {
      logger.info('Reconnect action triggered from notification');
      // User clicked "Reconnect" - initiate OAuth flow
      try {
        await handleConnectZoom();
      } catch (error) {
        logger.error('Reconnect from notification failed', error);
      }
    }
  });
}

// ============================================
// Service Worker Lifecycle
// ============================================

/**
 * Initialize the service worker
 */
async function initialize(): Promise<void> {
  logger.info('Initializing service worker...');

  try {
    // Initialize notification system
    initializeNotificationListeners();
    setupNotificationHandler();

    // Initialize meeting state (loads from storage, cleans up stale tabs)
    // Returns number of stale tabs that were cleaned up
    const staleTabCount = await initializeMeetingState();

    // Handle crash recovery if we had stale tabs
    await handleCrashRecovery(staleTabCount);

    // Initialize auth module (restores refresh timer)
    await initializeAuth();

    // Update badge to reflect current state
    await updateBadge();

    logger.info('Service worker initialized successfully');
  } catch (error) {
    logger.error('Service worker initialization failed', error);
  }
}

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  logger.info(`Extension installed/updated: ${details.reason}`);
  initialize().catch((error) => logger.error('Init failed on install', error));
});

// Handle service worker startup
chrome.runtime.onStartup.addListener(() => {
  logger.info('Service worker started up');
  initialize().catch((error) => logger.error('Init failed on startup', error));
});

// Listen for tab removal (to detect closed meeting tabs)
chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabClosed(tabId).catch((error) => logger.error('Tab close handler failed', error));
});

// Listen for tab URL changes (to detect navigation away from Meet)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  handleTabUpdated(tabId, changeInfo).catch((error) => logger.error('Tab update handler failed', error));
});

// Listen for window removal (to detect closed windows with meeting tabs)
chrome.windows.onRemoved.addListener((windowId) => {
  handleWindowClosed(windowId).catch((error) => logger.error('Window close handler failed', error));
});

// Initialize immediately in case service worker is starting fresh
initialize().catch((error) => logger.error('Immediate init failed', error));
