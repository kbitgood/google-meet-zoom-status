/**
 * Background service worker entry point
 * Handles Zoom status updates via Zoom Automator and meeting state management
 */

import type { ExtensionMessage, MeetingStateResponse } from '../types';
import {
  setInMeeting as zoomAutomatorSetInMeeting,
  clearMeeting as zoomAutomatorClearMeeting,
  isAvailable as isZoomAutomatorAvailable,
  getStatus as getZoomAutomatorStatus,
  ZoomAutomatorError,
} from './zoom-automator-api';
import {
  addMeetingTab,
  removeMeetingTab,
  hasActiveMeetings,
  getActiveMeetingCount,
  initializeMeetingState,
  getActiveMeetingTabs,
} from './meeting-state';
import { backgroundLogger as logger } from '../utils/logger';

logger.info('Service worker started');

// ============================================
// Badge Management
// ============================================

type BadgeState = 'disconnected' | 'connected' | 'in_meeting';

const BADGE_COLORS: Record<BadgeState, string> = {
  disconnected: '#808080', // Gray - Zoom Automator not available
  connected: '#22C55E',    // Green - Ready
  in_meeting: '#EF4444',   // Red - In meeting
};

const BADGE_TEXT: Record<BadgeState, string> = {
  disconnected: '!',
  connected: '',
  in_meeting: 'MTG',
};

/**
 * Update the extension badge to reflect current state
 */
async function updateBadge(): Promise<void> {
  const automatorAvailable = await isZoomAutomatorAvailable();
  
  let state: BadgeState;
  if (!automatorAvailable) {
    state = 'disconnected';
  } else {
    const inMeeting = await hasActiveMeetings();
    state = inMeeting ? 'in_meeting' : 'connected';
  }

  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[state] });
  await chrome.action.setBadgeText({ text: BADGE_TEXT[state] });

  logger.debug(`Badge updated to: ${state}`);
}

// ============================================
// Meeting Event Handlers
// ============================================

/**
 * Update Zoom status using Zoom Automator
 */
async function updateZoomStatus(joining: boolean): Promise<{ success: boolean; error?: string }> {
  const automatorAvailable = await isZoomAutomatorAvailable();
  
  if (!automatorAvailable) {
    logger.warn('Zoom Automator not available - ensure the Bun server is running');
    return { 
      success: false, 
      error: 'Zoom Automator not running. Start the local Bun server.' 
    };
  }

  try {
    if (joining) {
      await zoomAutomatorSetInMeeting();
      logger.info('Zoom status set via automation meeting');
    } else {
      await zoomAutomatorClearMeeting();
      logger.info('Zoom status cleared via automation meeting end');
    }
    return { success: true };
  } catch (error) {
    if (error instanceof ZoomAutomatorError) {
      logger.error(`Zoom Automator error (${error.code}): ${error.message}`);
      return { success: false, error: error.message };
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to update Zoom status: ${message}`);
    return { success: false, error: message };
  }
}

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

  return await updateZoomStatus(true);
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

  return await updateZoomStatus(false);
}

// ============================================
// Tab Event Handlers
// ============================================

/**
 * Handle tab close - treat as meeting left
 */
async function handleTabClosed(tabId: number): Promise<void> {
  logger.debug(`Tab ${tabId} closed`);

  const wasLastMeeting = await removeMeetingTab(tabId);

  if (wasLastMeeting) {
    logger.info('Last meeting tab closed, restoring Zoom status');
    await updateBadge();
    await updateZoomStatus(false);
  }
}

/**
 * Handle tab URL change - if navigating away from Meet, treat as meeting left
 */
async function handleTabUpdated(tabId: number, changeInfo: chrome.tabs.TabChangeInfo): Promise<void> {
  if (!changeInfo.url) {
    return;
  }

  const meetingTabs = await getActiveMeetingTabs();
  const tabWasInMeeting = meetingTabs.some(tab => tab.tabId === tabId);
  if (!tabWasInMeeting) {
    return;
  }

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

  const meetingTabs = await getActiveMeetingTabs();
  if (meetingTabs.length === 0) {
    return;
  }

  const tabsToRemove: number[] = [];

  for (const tab of meetingTabs) {
    try {
      await chrome.tabs.get(tab.tabId);
    } catch {
      tabsToRemove.push(tab.tabId);
    }
  }

  if (tabsToRemove.length === 0) {
    return;
  }

  logger.info(`Found ${tabsToRemove.length} meeting tab(s) in closed window`);

  for (const tabId of tabsToRemove) {
    await handleMeetingLeft(tabId);
  }
}

// ============================================
// Message Handler
// ============================================

interface ZoomAutomatorStatusResponse {
  isConnected: boolean;
  zoomStatus?: string;
}

async function handleGetZoomAutomatorStatus(): Promise<ZoomAutomatorStatusResponse> {
  const isConnected = await isZoomAutomatorAvailable();
  let zoomStatus: string | undefined;
  
  if (isConnected) {
    zoomStatus = (await getZoomAutomatorStatus()) ?? undefined;
  }
  
  return { isConnected, zoomStatus };
}

/**
 * Handle messages asynchronously
 */
async function handleMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
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

    case 'GET_ZOOM_AUTOMATOR_STATUS':
      return handleGetZoomAutomatorStatus();

    default:
      logger.warn('Unknown message type:', message);
      return { success: false, error: 'Unknown message type' };
  }
}

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      logger.error('Message handling error', error);
      sendResponse({ success: false, error: error.message });
    });

  return true;
});

// ============================================
// Service Worker Lifecycle
// ============================================

/**
 * Initialize the service worker
 */
async function initialize(): Promise<void> {
  logger.info('Initializing service worker...');

  try {
    // Initialize meeting state (loads from storage, cleans up stale tabs)
    const staleTabCount = await initializeMeetingState();
    
    if (staleTabCount > 0) {
      logger.warn(`Cleaned up ${staleTabCount} stale meeting tab(s)`);
      // If we had stale tabs and no active meetings remain, clear Zoom status
      const hasRemaining = await hasActiveMeetings();
      if (!hasRemaining) {
        await updateZoomStatus(false);
      }
    }

    // Update badge to reflect current state
    await updateBadge();

    // Check Zoom Automator availability
    const automatorAvailable = await isZoomAutomatorAvailable();
    if (automatorAvailable) {
      logger.info('Zoom Automator connection established');
    } else {
      logger.warn('Zoom Automator not available - status updates will not work');
    }

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

// Listen for tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabClosed(tabId).catch((error) => logger.error('Tab close handler failed', error));
});

// Listen for tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  handleTabUpdated(tabId, changeInfo).catch((error) => logger.error('Tab update handler failed', error));
});

// Listen for window removal
chrome.windows.onRemoved.addListener((windowId) => {
  handleWindowClosed(windowId).catch((error) => logger.error('Window close handler failed', error));
});

// Initialize immediately
initialize().catch((error) => logger.error('Immediate init failed', error));
