/**
 * Popup script entry point
 * Handles popup UI interactions and state display
 */

import type { ExtensionMessage, MeetingStateResponse, HammerspoonStatusResponse } from '../types';
import { popupLogger as logger } from '../utils/logger';

logger.info('Popup script loaded');

// ============================================
// DOM Element References
// ============================================

interface PopupElements {
  hammerspoonStatusCard: HTMLElement | null;
  hammerspoonIndicator: HTMLElement | null;
  hammerspoonStatusText: HTMLElement | null;
  
  meetingStatusCard: HTMLElement | null;
  meetingIndicator: HTMLElement | null;
  meetingStatusText: HTMLElement | null;
  
  zoomStatusText: HTMLElement | null;
}

function getElements(): PopupElements {
  return {
    hammerspoonStatusCard: document.getElementById('hammerspoon-status-card'),
    hammerspoonIndicator: document.getElementById('hammerspoon-indicator'),
    hammerspoonStatusText: document.getElementById('hammerspoon-status-text'),
    
    meetingStatusCard: document.getElementById('meeting-status-card'),
    meetingIndicator: document.getElementById('meeting-indicator'),
    meetingStatusText: document.getElementById('meeting-status-text'),
    
    zoomStatusText: document.getElementById('zoom-status-text'),
  };
}

// ============================================
// State Management
// ============================================

interface PopupState {
  isHammerspoonConnected: boolean;
  isInMeeting: boolean;
  zoomStatus: string | null;
}

const state: PopupState = {
  isHammerspoonConnected: false,
  isInMeeting: false,
  zoomStatus: null,
};

// ============================================
// UI Update Functions
// ============================================

function updateUI(): void {
  const elements = getElements();
  
  // Update Hammerspoon connection status
  if (elements.hammerspoonStatusCard && elements.hammerspoonIndicator && elements.hammerspoonStatusText) {
    if (state.isHammerspoonConnected) {
      elements.hammerspoonStatusCard.classList.add('connected');
      elements.hammerspoonStatusCard.classList.remove('disconnected');
      elements.hammerspoonIndicator.classList.add('connected');
      elements.hammerspoonIndicator.classList.remove('disconnected');
      elements.hammerspoonStatusText.textContent = 'Connected';
    } else {
      elements.hammerspoonStatusCard.classList.remove('connected');
      elements.hammerspoonStatusCard.classList.add('disconnected');
      elements.hammerspoonIndicator.classList.remove('connected');
      elements.hammerspoonIndicator.classList.add('disconnected');
      elements.hammerspoonStatusText.textContent = 'Not running';
    }
  }
  
  // Update meeting status
  if (elements.meetingStatusCard && elements.meetingIndicator && elements.meetingStatusText) {
    if (state.isInMeeting) {
      elements.meetingStatusCard.classList.add('in-meeting');
      elements.meetingIndicator.classList.add('in-meeting');
      elements.meetingIndicator.classList.remove('not-in-meeting');
      elements.meetingStatusText.textContent = 'In a meeting';
    } else {
      elements.meetingStatusCard.classList.remove('in-meeting');
      elements.meetingIndicator.classList.remove('in-meeting');
      elements.meetingIndicator.classList.add('not-in-meeting');
      elements.meetingStatusText.textContent = 'Not in a meeting';
    }
  }
  
  // Update Zoom status
  if (elements.zoomStatusText) {
    if (state.zoomStatus) {
      elements.zoomStatusText.textContent = state.zoomStatus;
    } else if (state.isHammerspoonConnected) {
      elements.zoomStatusText.textContent = 'Unknown';
    } else {
      elements.zoomStatusText.textContent = '-';
    }
  }
}

// ============================================
// Background Script Communication
// ============================================

async function sendMessage<T>(message: ExtensionMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function fetchHammerspoonStatus(): Promise<void> {
  try {
    const response = await sendMessage<HammerspoonStatusResponse>({ type: 'GET_HAMMERSPOON_STATUS' });
    state.isHammerspoonConnected = response.isConnected;
    state.zoomStatus = response.zoomStatus ?? null;
    logger.debug('Hammerspoon status:', response);
  } catch (error) {
    logger.error('Failed to get Hammerspoon status', error);
    state.isHammerspoonConnected = false;
    state.zoomStatus = null;
  }
}

async function fetchMeetingStatus(): Promise<void> {
  try {
    const response = await sendMessage<MeetingStateResponse>({ type: 'GET_MEETING_STATE' });
    state.isInMeeting = response.isInMeeting;
    logger.debug('Meeting status:', response);
  } catch (error) {
    logger.error('Failed to get meeting status', error);
    state.isInMeeting = false;
  }
}

async function refreshStatus(): Promise<void> {
  await Promise.all([
    fetchHammerspoonStatus(),
    fetchMeetingStatus(),
  ]);
  updateUI();
}

// ============================================
// Storage Change Listener (Real-time updates)
// ============================================

function handleStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
): void {
  if (areaName !== 'local') return;
  
  logger.debug('Storage changed:', Object.keys(changes));
  
  // Check for meeting state changes
  if ('meetingStateData' in changes) {
    const newValue = changes['meetingStateData'].newValue;
    if (newValue && Array.isArray(newValue.activeTabs)) {
      state.isInMeeting = newValue.activeTabs.length > 0;
    } else {
      state.isInMeeting = false;
    }
    logger.debug('Meeting state updated:', state.isInMeeting);
    updateUI();
  }
}

// ============================================
// Initialization
// ============================================

function setupEventListeners(): void {
  // Listen for storage changes for real-time updates
  chrome.storage.onChanged.addListener(handleStorageChange);
}

async function initialize(): Promise<void> {
  logger.info('Initializing...');
  
  setupEventListeners();
  await refreshStatus();
  
  // Periodically refresh Hammerspoon status
  setInterval(() => {
    fetchHammerspoonStatus().then(updateUI);
  }, 5000);
  
  logger.info('Initialization complete');
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
