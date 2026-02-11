/**
 * Popup script entry point
 * Handles popup UI interactions and state display
 */

import type {
  ExtensionMessage,
  MeetingStateResponse,
  ZoomAutomatorStatusResponse,
} from '../types';
import { popupLogger as logger } from '../utils/logger';

logger.info('Popup script loaded');

// ============================================
// DOM Element References
// ============================================

interface PopupElements {
  automatorStatusCard: HTMLElement | null;
  automatorIndicator: HTMLElement | null;
  automatorStatusText: HTMLElement | null;
  
  meetingStatusCard: HTMLElement | null;
  meetingIndicator: HTMLElement | null;
  meetingStatusText: HTMLElement | null;
  
  zoomStatusText: HTMLElement | null;
}

function getElements(): PopupElements {
  return {
    automatorStatusCard: document.getElementById('automator-status-card'),
    automatorIndicator: document.getElementById('automator-indicator'),
    automatorStatusText: document.getElementById('automator-status-text'),
    
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
  isAutomatorConnected: boolean;
  isInMeeting: boolean;
  zoomStatus: string | null;
}

const state: PopupState = {
  isAutomatorConnected: false,
  isInMeeting: false,
  zoomStatus: null,
};

// ============================================
// UI Update Functions
// ============================================

function updateUI(): void {
  const elements = getElements();
  
  // Update Zoom Automator connection status
  if (elements.automatorStatusCard && elements.automatorIndicator && elements.automatorStatusText) {
    if (state.isAutomatorConnected) {
      elements.automatorStatusCard.classList.add('connected');
      elements.automatorStatusCard.classList.remove('disconnected');
      elements.automatorIndicator.classList.add('connected');
      elements.automatorIndicator.classList.remove('disconnected');
      elements.automatorStatusText.textContent = 'Connected';
    } else {
      elements.automatorStatusCard.classList.remove('connected');
      elements.automatorStatusCard.classList.add('disconnected');
      elements.automatorIndicator.classList.remove('connected');
      elements.automatorIndicator.classList.add('disconnected');
      elements.automatorStatusText.textContent = 'Not running';
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
    } else if (state.isAutomatorConnected) {
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

async function fetchZoomAutomatorStatus(): Promise<void> {
  try {
    const response = await sendMessage<ZoomAutomatorStatusResponse>({
      type: 'GET_ZOOM_AUTOMATOR_STATUS',
    });
    state.isAutomatorConnected = response.isConnected;
    state.zoomStatus = response.zoomStatus ?? null;
    logger.debug('Zoom Automator status:', response);
  } catch (error) {
    logger.error('Failed to get Zoom Automator status', error);
    state.isAutomatorConnected = false;
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
    fetchZoomAutomatorStatus(),
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
  
  // Periodically refresh Zoom Automator status
  setInterval(() => {
    fetchZoomAutomatorStatus().then(updateUI);
  }, 5000);
  
  logger.info('Initialization complete');
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
