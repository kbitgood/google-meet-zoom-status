/**
 * Popup script entry point
 * Handles popup UI interactions and state display
 */

import type { 
  ExtensionMessage, 
  AuthStatusResponse, 
  MeetingStateResponse,
  AuthOperationResponse 
} from '../types';
import { popupLogger as logger } from '../utils/logger';
import { getErrorState, clearErrorState, type ErrorState } from '../utils/notifications';

logger.info('Popup script loaded');

// ============================================
// DOM Element References
// ============================================

interface PopupElements {
  // Status indicators
  zoomStatusCard: HTMLElement | null;
  zoomIndicator: HTMLElement | null;
  zoomStatusText: HTMLElement | null;
  
  meetingStatusCard: HTMLElement | null;
  meetingIndicator: HTMLElement | null;
  meetingStatusText: HTMLElement | null;
  
  // Buttons
  connectBtn: HTMLButtonElement | null;
  disconnectBtn: HTMLButtonElement | null;
  
  // Loading and error
  loadingOverlay: HTMLElement | null;
  errorBanner: HTMLElement | null;
  errorIcon: HTMLElement | null;
  errorTitle: HTMLElement | null;
  errorText: HTMLElement | null;
  errorAction: HTMLButtonElement | null;
  errorDismiss: HTMLButtonElement | null;
}

function getElements(): PopupElements {
  return {
    zoomStatusCard: document.getElementById('zoom-status-card'),
    zoomIndicator: document.getElementById('zoom-indicator'),
    zoomStatusText: document.getElementById('zoom-status-text'),
    
    meetingStatusCard: document.getElementById('meeting-status-card'),
    meetingIndicator: document.getElementById('meeting-indicator'),
    meetingStatusText: document.getElementById('meeting-status-text'),
    
    connectBtn: document.getElementById('connect-btn') as HTMLButtonElement | null,
    disconnectBtn: document.getElementById('disconnect-btn') as HTMLButtonElement | null,
    
    loadingOverlay: document.getElementById('loading-overlay'),
    errorBanner: document.getElementById('error-banner'),
    errorIcon: document.getElementById('error-icon'),
    errorTitle: document.getElementById('error-title'),
    errorText: document.getElementById('error-text'),
    errorAction: document.getElementById('error-action') as HTMLButtonElement | null,
    errorDismiss: document.getElementById('error-dismiss') as HTMLButtonElement | null,
  };
}

// ============================================
// State Management
// ============================================

interface PopupState {
  isAuthenticated: boolean;
  isInMeeting: boolean;
  isLoading: boolean;
  errorState: ErrorState | null;
}

const state: PopupState = {
  isAuthenticated: false,
  isInMeeting: false,
  isLoading: false,
  errorState: null,
};

// ============================================
// UI Update Functions
// ============================================

function updateUI(): void {
  const elements = getElements();
  
  // Update Zoom connection status
  if (elements.zoomStatusCard && elements.zoomIndicator && elements.zoomStatusText) {
    // Check for auth-related errors
    const hasAuthError = state.errorState?.type === 'auth_expired' && !state.errorState.dismissed;
    
    if (state.isAuthenticated && !hasAuthError) {
      elements.zoomStatusCard.classList.add('connected');
      elements.zoomStatusCard.classList.remove('disconnected', 'error');
      elements.zoomIndicator.classList.add('connected');
      elements.zoomIndicator.classList.remove('disconnected', 'error');
      elements.zoomStatusText.textContent = 'Connected';
    } else if (hasAuthError) {
      elements.zoomStatusCard.classList.remove('connected', 'disconnected');
      elements.zoomStatusCard.classList.add('error');
      elements.zoomIndicator.classList.remove('connected', 'disconnected');
      elements.zoomIndicator.classList.add('error');
      elements.zoomStatusText.textContent = 'Session expired';
    } else {
      elements.zoomStatusCard.classList.remove('connected', 'error');
      elements.zoomStatusCard.classList.add('disconnected');
      elements.zoomIndicator.classList.remove('connected', 'error');
      elements.zoomIndicator.classList.add('disconnected');
      elements.zoomStatusText.textContent = 'Not connected';
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
  
  // Update buttons visibility
  const hasAuthError = state.errorState?.type === 'auth_expired' && !state.errorState.dismissed;
  if (elements.connectBtn) {
    elements.connectBtn.style.display = (state.isAuthenticated && !hasAuthError) ? 'none' : 'flex';
  }
  if (elements.disconnectBtn) {
    elements.disconnectBtn.style.display = (state.isAuthenticated && !hasAuthError) ? 'flex' : 'none';
  }
  
  // Update loading state
  if (elements.loadingOverlay) {
    if (state.isLoading) {
      elements.loadingOverlay.classList.add('visible');
    } else {
      elements.loadingOverlay.classList.remove('visible');
    }
  }
  
  // Update error banner
  updateErrorBanner(elements);
}

/**
 * Update error banner based on current error state
 */
function updateErrorBanner(elements: PopupElements): void {
  if (!elements.errorBanner || !elements.errorTitle || !elements.errorText) {
    return;
  }
  
  // Hide if no error or error is dismissed
  if (!state.errorState || state.errorState.dismissed) {
    elements.errorBanner.style.display = 'none';
    return;
  }
  
  // Show error banner
  elements.errorBanner.style.display = 'block';
  
  // Set error type styling
  elements.errorBanner.className = 'error-banner ' + state.errorState.type;
  
  // Set content based on error type
  switch (state.errorState.type) {
    case 'auth_expired':
      if (elements.errorIcon) {
        elements.errorIcon.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>`;
      }
      elements.errorTitle.textContent = 'Session Expired';
      elements.errorText.textContent = state.errorState.message;
      if (elements.errorAction) {
        elements.errorAction.textContent = 'Reconnect';
        elements.errorAction.style.display = 'inline-flex';
      }
      break;
    
    case 'network_error':
      if (elements.errorIcon) {
        elements.errorIcon.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.606 12.97a.75.75 0 01-.134 1.051 2.494 2.494 0 00-.93 2.437 2.494 2.494 0 002.437-.93.75.75 0 111.186.918 3.995 3.995 0 01-4.482 1.332.75.75 0 01-.461-.461 3.994 3.994 0 011.332-4.482.75.75 0 011.052.135z" clip-rule="evenodd"/><path fill-rule="evenodd" d="M13.703 4.606a.75.75 0 01.134-1.051c1.36-.99 3.303-.749 4.482 1.332.749 1.323.749 2.962 0 4.482-.99 1.36-3.122 2.322-4.482 1.332a.75.75 0 111.186-.918c.543.747 1.724.296 2.437-.93a2.494 2.494 0 000-2.437c-.713-1.226-1.894-1.677-2.437-.93a.75.75 0 01-1.32-.88z" clip-rule="evenodd"/><path d="M3.75 8.25a.75.75 0 000 1.5h9.546c1.09 0 1.972.883 1.972 1.972 0 .166-.026.328-.076.48a.75.75 0 101.425.47c.11-.335.168-.693.168-1.059a3.472 3.472 0 00-3.489-3.363H3.75z"/></svg>`;
      }
      elements.errorTitle.textContent = 'Connection Error';
      elements.errorText.textContent = state.errorState.message;
      if (elements.errorAction) {
        elements.errorAction.textContent = 'Retry';
        elements.errorAction.style.display = 'inline-flex';
      }
      break;
    
    case 'api_error':
    default:
      if (elements.errorIcon) {
        elements.errorIcon.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd"/></svg>`;
      }
      elements.errorTitle.textContent = 'Error';
      elements.errorText.textContent = state.errorState.message;
      if (elements.errorAction) {
        elements.errorAction.style.display = 'none';
      }
      break;
  }
}

function showLoading(message = 'Connecting...'): void {
  state.isLoading = true;
  const elements = getElements();
  const loadingSpan = elements.loadingOverlay?.querySelector('span');
  if (loadingSpan) {
    loadingSpan.textContent = message;
  }
  updateUI();
}

function hideLoading(): void {
  state.isLoading = false;
  updateUI();
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

async function fetchAuthStatus(): Promise<void> {
  try {
    const response = await sendMessage<AuthStatusResponse>({ type: 'GET_AUTH_STATUS' });
    state.isAuthenticated = response.isAuthenticated;
    logger.debug('Auth status:', response);
  } catch (error) {
    logger.error('Failed to get auth status', error);
    state.isAuthenticated = false;
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

async function fetchErrorState(): Promise<void> {
  try {
    const errorState = await getErrorState();
    state.errorState = errorState;
    logger.debug('Error state:', errorState);
  } catch (error) {
    logger.error('Failed to get error state', error);
    state.errorState = null;
  }
}

async function refreshStatus(): Promise<void> {
  await Promise.all([
    fetchAuthStatus(),
    fetchMeetingStatus(),
    fetchErrorState(),
  ]);
  updateUI();
}

// ============================================
// Event Handlers
// ============================================

async function handleConnect(): Promise<void> {
  logger.info('Connect button clicked');
  showLoading('Connecting to Zoom...');
  
  try {
    const response = await sendMessage<AuthOperationResponse>({ type: 'CONNECT_ZOOM' });
    
    if (response.success) {
      logger.info('Successfully connected to Zoom');
      state.isAuthenticated = true;
      state.errorState = null;
      await clearErrorState();
    } else {
      logger.error('Failed to connect:', response.error);
      
      // Handle specific error types
      if (response.errorCode === 'USER_CANCELLED') {
        // User cancelled, no need to show error
        logger.debug('User cancelled OAuth flow');
      } else {
        // Error will be shown from background's error state
        await fetchErrorState();
      }
    }
  } catch (error) {
    logger.error('Connect error', error);
    await fetchErrorState();
  } finally {
    hideLoading();
  }
}

async function handleDisconnect(): Promise<void> {
  logger.info('Disconnect button clicked');
  showLoading('Disconnecting...');
  
  try {
    const response = await sendMessage<AuthOperationResponse>({ type: 'DISCONNECT_ZOOM' });
    
    if (response.success) {
      logger.info('Successfully disconnected from Zoom');
      state.isAuthenticated = false;
      state.errorState = null;
      await clearErrorState();
    } else {
      logger.error('Failed to disconnect:', response.error);
      await fetchErrorState();
    }
  } catch (error) {
    logger.error('Disconnect error', error);
    await fetchErrorState();
  } finally {
    hideLoading();
  }
}

async function handleErrorAction(): Promise<void> {
  if (!state.errorState) return;
  
  logger.info('Error action button clicked', { type: state.errorState.type });
  
  switch (state.errorState.type) {
    case 'auth_expired':
      // Reconnect
      await handleConnect();
      break;
    
    case 'network_error':
      // Retry - refresh status
      showLoading('Retrying...');
      await clearErrorState();
      state.errorState = null;
      await refreshStatus();
      hideLoading();
      break;
    
    default:
      // Dismiss
      await handleErrorDismiss();
  }
}

async function handleErrorDismiss(): Promise<void> {
  logger.debug('Error dismissed');
  await clearErrorState();
  state.errorState = null;
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
  
  // Check for auth changes
  if ('zoomToken' in changes) {
    const newValue = changes['zoomToken'].newValue;
    state.isAuthenticated = !!newValue;
    logger.debug('Auth state updated:', state.isAuthenticated);
    updateUI();
  }
  
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
  
  // Check for error state changes
  if ('lastErrorState' in changes) {
    const newValue = changes['lastErrorState'].newValue as ErrorState | undefined;
    state.errorState = newValue || null;
    logger.debug('Error state updated:', state.errorState);
    updateUI();
  }
}

// ============================================
// Initialization
// ============================================

function setupEventListeners(): void {
  const elements = getElements();
  
  if (elements.connectBtn) {
    elements.connectBtn.addEventListener('click', handleConnect);
  }
  
  if (elements.disconnectBtn) {
    elements.disconnectBtn.addEventListener('click', handleDisconnect);
  }
  
  if (elements.errorAction) {
    elements.errorAction.addEventListener('click', handleErrorAction);
  }
  
  if (elements.errorDismiss) {
    elements.errorDismiss.addEventListener('click', handleErrorDismiss);
  }
  
  // Listen for storage changes for real-time updates
  chrome.storage.onChanged.addListener(handleStorageChange);
}

async function initialize(): Promise<void> {
  logger.info('Initializing...');
  
  // Setup event listeners
  setupEventListeners();
  
  // Fetch initial status
  await refreshStatus();
  
  logger.info('Initialization complete');
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
