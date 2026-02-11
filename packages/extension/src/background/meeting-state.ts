/**
 * Meeting State Management Module
 * Tracks active meeting tabs and persists state for service worker restarts
 */

import { backgroundLogger as logger } from '../utils/logger';

// ============================================
// Types
// ============================================

/**
 * Information about an active meeting tab
 */
export interface ActiveMeetingTab {
  tabId: number;
  meetingId?: string;
  joinedAt: number; // Unix timestamp in milliseconds
}

/**
 * State persisted to storage
 */
export interface MeetingStateData {
  activeTabs: ActiveMeetingTab[];
  statusChangedAt: number | null; // When we changed the Zoom status
}

// Storage key for meeting state
const MEETING_STATE_STORAGE_KEY = 'meetingStateData';

// ============================================
// Private: State Management
// ============================================

/**
 * In-memory state (for fast access during service worker lifetime)
 */
let stateCache: MeetingStateData | null = null;

/**
 * Load state from storage
 */
async function loadState(): Promise<MeetingStateData> {
  if (stateCache) {
    return stateCache;
  }

  const result = await chrome.storage.local.get(MEETING_STATE_STORAGE_KEY);
  const stored = result[MEETING_STATE_STORAGE_KEY] as MeetingStateData | undefined;

  stateCache = stored ?? {
    activeTabs: [],
    statusChangedAt: null,
  };

  return stateCache;
}

/**
 * Save state to storage (and update cache)
 */
async function saveState(state: MeetingStateData): Promise<void> {
  stateCache = state;
  await chrome.storage.local.set({ [MEETING_STATE_STORAGE_KEY]: state });
}

// ============================================
// Public: Meeting Tab Management
// ============================================

/**
 * Add a tab to the active meeting tabs list
 * Returns true if this is the first meeting tab (meaning we should update Zoom status)
 */
export async function addMeetingTab(tabId: number, meetingId?: string): Promise<boolean> {
  const state = await loadState();

  // Check if tab already exists
  const existingIndex = state.activeTabs.findIndex(t => t.tabId === tabId);
  if (existingIndex !== -1) {
    // Update existing tab's meeting ID if changed
    state.activeTabs[existingIndex].meetingId = meetingId;
    await saveState(state);
    logger.debug(`Tab ${tabId} already tracked, updated meetingId`);
    return false;
  }

  const wasEmpty = state.activeTabs.length === 0;

  // Add new tab
  state.activeTabs.push({
    tabId,
    meetingId,
    joinedAt: Date.now(),
  });

  await saveState(state);
  logger.debug(`Added tab ${tabId}, total active: ${state.activeTabs.length}`);

  return wasEmpty;
}

/**
 * Remove a tab from the active meeting tabs list
 * Returns true if there are no more meeting tabs (meaning we should restore Zoom status)
 */
export async function removeMeetingTab(tabId: number): Promise<boolean> {
  const state = await loadState();

  const existingIndex = state.activeTabs.findIndex(t => t.tabId === tabId);
  if (existingIndex === -1) {
    logger.debug(`Tab ${tabId} not found in active tabs`);
    return false;
  }

  state.activeTabs.splice(existingIndex, 1);
  await saveState(state);

  const isEmpty = state.activeTabs.length === 0;
  logger.debug(`Removed tab ${tabId}, remaining: ${state.activeTabs.length}`);

  return isEmpty;
}

/**
 * Check if a tab is currently in a meeting
 */
export async function isTabInMeeting(tabId: number): Promise<boolean> {
  const state = await loadState();
  return state.activeTabs.some(t => t.tabId === tabId);
}

/**
 * Get all active meeting tabs
 */
export async function getActiveMeetingTabs(): Promise<ActiveMeetingTab[]> {
  const state = await loadState();
  return [...state.activeTabs];
}

/**
 * Get the count of active meeting tabs
 */
export async function getActiveMeetingCount(): Promise<number> {
  const state = await loadState();
  return state.activeTabs.length;
}

/**
 * Check if there are any active meetings
 */
export async function hasActiveMeetings(): Promise<boolean> {
  const state = await loadState();
  return state.activeTabs.length > 0;
}

// ============================================
// Public: State Queries
// ============================================

/**
 * Get the full meeting state for external use
 */
export async function getMeetingStateData(): Promise<MeetingStateData> {
  return loadState();
}

/**
 * Check if we're currently in "meeting mode" (have active meetings and changed status)
 */
export async function isInMeetingMode(): Promise<boolean> {
  const state = await loadState();
  return state.activeTabs.length > 0 && state.statusChangedAt !== null;
}

// ============================================
// Public: Cleanup and Recovery
// ============================================

/**
 * Clean up stale tabs (tabs that no longer exist)
 * Should be called on service worker startup
 */
export async function cleanupStaleTabs(): Promise<number> {
  const state = await loadState();
  if (state.activeTabs.length === 0) {
    return 0;
  }

  logger.debug(`Checking ${state.activeTabs.length} tabs for staleness`);

  const validTabs: ActiveMeetingTab[] = [];
  const staleTabs: number[] = [];

  for (const tab of state.activeTabs) {
    try {
      const chromeTab = await chrome.tabs.get(tab.tabId);
      // Check if tab still exists and is a Meet page
      if (chromeTab && chromeTab.url?.includes('meet.google.com')) {
        validTabs.push(tab);
      } else {
        staleTabs.push(tab.tabId);
      }
    } catch {
      // Tab doesn't exist anymore
      staleTabs.push(tab.tabId);
    }
  }

  if (staleTabs.length > 0) {
    logger.info(`Removing ${staleTabs.length} stale tabs`, { staleTabs });
    state.activeTabs = validTabs;
    await saveState(state);
  }

  return staleTabs.length;
}

/**
 * Reset all meeting state (for testing or recovery)
 */
export async function resetMeetingState(): Promise<void> {
  stateCache = {
    activeTabs: [],
    statusChangedAt: null,
  };
  await chrome.storage.local.remove(MEETING_STATE_STORAGE_KEY);
  logger.info('Reset all meeting state');
}

/**
 * Initialize meeting state module
 * Should be called on service worker startup
 * Returns the number of stale tabs that were cleaned up (for crash recovery)
 */
export async function initializeMeetingState(): Promise<number> {
  logger.info('Initializing meeting state...');

  // Load state from storage
  await loadState();

  // Clean up any stale tabs
  const staleCount = await cleanupStaleTabs();
  if (staleCount > 0) {
    logger.debug(`Cleaned up ${staleCount} stale tabs`);
  }

  const state = await loadState();
  logger.info(`Meeting state initialized with ${state.activeTabs.length} active tabs`);

  return staleCount;
}
