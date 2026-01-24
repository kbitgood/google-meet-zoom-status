/**
 * Chrome Notifications Utility
 * Provides user notifications for errors and important events
 */

import { createLogger } from './logger';

const logger = createLogger('Notifications');

/**
 * Notification types for different scenarios
 */
export type NotificationType = 
  | 'error'           // General error
  | 'auth_expired'    // Authentication expired
  | 'api_error'       // Zoom API error
  | 'network_error'   // Network connectivity issue
  | 'success'         // Success confirmation
  | 'info';           // Informational

/**
 * Options for creating a notification
 */
export interface NotificationOptions {
  title: string;
  message: string;
  type?: NotificationType;
  buttons?: Array<{ title: string }>;
  requireInteraction?: boolean;
  silent?: boolean;
}

/**
 * Notification IDs for tracking
 */
const NOTIFICATION_IDS = {
  AUTH_EXPIRED: 'zoom-auth-expired',
  API_ERROR: 'zoom-api-error',
  NETWORK_ERROR: 'zoom-network-error',
} as const;

/**
 * Storage key for notification preferences
 */
const NOTIFICATIONS_ENABLED_KEY = 'notificationsEnabled';

/**
 * Check if notifications are enabled
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  try {
    const result = await chrome.storage.local.get(NOTIFICATIONS_ENABLED_KEY);
    // Default to true if not set
    return result[NOTIFICATIONS_ENABLED_KEY] !== false;
  } catch {
    return true;
  }
}

/**
 * Enable or disable notifications
 */
export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [NOTIFICATIONS_ENABLED_KEY]: enabled });
  logger.info(`Notifications ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Get the icon URL for the notification type
 */
function getIconUrl(_type: NotificationType): string {
  // Use the extension's icon
  return chrome.runtime.getURL('icons/icon-128.png');
}

/**
 * Show a Chrome notification
 */
export async function showNotification(
  id: string,
  options: NotificationOptions
): Promise<string | undefined> {
  // Check if notifications are enabled
  const enabled = await areNotificationsEnabled();
  if (!enabled) {
    logger.debug('Notifications disabled, skipping', { id });
    return undefined;
  }

  const iconUrl = getIconUrl(options.type || 'info');
  
  const notificationOptions: chrome.notifications.NotificationOptions<true> = {
    type: 'basic',
    iconUrl,
    title: options.title,
    message: options.message,
    priority: options.type === 'error' || options.type === 'auth_expired' ? 2 : 1,
    requireInteraction: options.requireInteraction ?? false,
    silent: options.silent ?? false,
  };

  // Add buttons if provided
  if (options.buttons && options.buttons.length > 0) {
    notificationOptions.buttons = options.buttons;
  }

  try {
    return new Promise<string>((resolve, reject) => {
      chrome.notifications.create(id, notificationOptions, (notificationId) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(notificationId);
        }
      });
    });
  } catch (error) {
    logger.error('Failed to create notification', { id, error });
    return undefined;
  }
}

/**
 * Clear a notification by ID
 */
export async function clearNotification(id: string): Promise<void> {
  try {
    await chrome.notifications.clear(id);
  } catch {
    // Silently fail if notification doesn't exist
  }
}

/**
 * Clear all extension notifications
 */
export async function clearAllNotifications(): Promise<void> {
  try {
    const ids = Object.values(NOTIFICATION_IDS);
    await Promise.all(ids.map(id => chrome.notifications.clear(id)));
  } catch {
    // Silently fail
  }
}

// ============================================
// Specific Notification Functions
// ============================================

/**
 * Show notification when Zoom API call fails
 */
export async function notifyApiError(errorMessage: string): Promise<void> {
  await showNotification(NOTIFICATION_IDS.API_ERROR, {
    type: 'api_error',
    title: 'Zoom Status Update Failed',
    message: `Failed to update your Zoom status: ${errorMessage}`,
    requireInteraction: false,
  });
  
  logger.warn('API error notification shown', { errorMessage });
}

/**
 * Show notification when authentication expires
 * Includes a "Reconnect" action button
 */
export async function notifyAuthExpired(): Promise<void> {
  await showNotification(NOTIFICATION_IDS.AUTH_EXPIRED, {
    type: 'auth_expired',
    title: 'Zoom Connection Expired',
    message: 'Your Zoom connection has expired. Click the extension icon to reconnect.',
    buttons: [{ title: 'Reconnect' }],
    requireInteraction: true,
  });
  
  logger.warn('Auth expired notification shown');
}

/**
 * Show notification for network errors
 */
export async function notifyNetworkError(): Promise<void> {
  await showNotification(NOTIFICATION_IDS.NETWORK_ERROR, {
    type: 'network_error',
    title: 'Connection Error',
    message: 'Unable to reach Zoom. Check your internet connection.',
    requireInteraction: false,
  });
  
  logger.warn('Network error notification shown');
}

/**
 * Show success notification (optional, usually silent)
 */
export async function notifySuccess(message: string): Promise<void> {
  await showNotification('zoom-success-' + Date.now(), {
    type: 'success',
    title: 'Meet to Zoom',
    message,
    silent: true,
  });
}

// ============================================
// Notification Click Handler
// ============================================

/**
 * Notification button click actions
 */
export type NotificationButtonAction = 'reconnect' | 'dismiss';

/**
 * Callback for notification button clicks
 */
export type NotificationButtonCallback = (action: NotificationButtonAction) => void;

// Store callback for notification button clicks
let buttonClickCallback: NotificationButtonCallback | null = null;

/**
 * Set callback for notification button clicks
 */
export function onNotificationButtonClick(callback: NotificationButtonCallback): void {
  buttonClickCallback = callback;
}

/**
 * Initialize notification click listener
 * Call this from the background script
 */
export function initializeNotificationListeners(): void {
  // Handle notification button clicks
  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    logger.debug('Notification button clicked', { notificationId, buttonIndex });
    
    if (notificationId === NOTIFICATION_IDS.AUTH_EXPIRED && buttonIndex === 0) {
      // Reconnect button clicked
      if (buttonClickCallback) {
        buttonClickCallback('reconnect');
      }
      // Clear the notification
      clearNotification(notificationId);
    }
  });

  // Handle notification click (not button)
  chrome.notifications.onClicked.addListener((notificationId) => {
    logger.debug('Notification clicked', { notificationId });
    
    // Open the popup when notification is clicked
    if (notificationId === NOTIFICATION_IDS.AUTH_EXPIRED) {
      // Can't directly open popup, but we can focus the extension
      chrome.action.openPopup?.().catch(() => {
        // Fallback: do nothing, user can click the extension icon
      });
    }
    
    // Clear the notification
    clearNotification(notificationId);
  });

  logger.info('Notification listeners initialized');
}

// ============================================
// Error State Storage (for popup display)
// ============================================

/**
 * Error state structure for UI display
 */
export interface ErrorState {
  type: 'api_error' | 'auth_expired' | 'network_error' | 'none';
  message: string;
  timestamp: number;
  dismissed: boolean;
}

const ERROR_STATE_KEY = 'lastErrorState';

/**
 * Save error state for popup display
 */
export async function saveErrorState(
  type: ErrorState['type'],
  message: string
): Promise<void> {
  const errorState: ErrorState = {
    type,
    message,
    timestamp: Date.now(),
    dismissed: false,
  };
  
  await chrome.storage.local.set({ [ERROR_STATE_KEY]: errorState });
  logger.debug('Error state saved', errorState);
}

/**
 * Get current error state
 */
export async function getErrorState(): Promise<ErrorState | null> {
  try {
    const result = await chrome.storage.local.get(ERROR_STATE_KEY);
    const state = result[ERROR_STATE_KEY] as ErrorState | undefined;
    
    // Consider errors older than 1 hour as stale
    if (state && Date.now() - state.timestamp > 60 * 60 * 1000) {
      await clearErrorState();
      return null;
    }
    
    return state || null;
  } catch {
    return null;
  }
}

/**
 * Clear error state
 */
export async function clearErrorState(): Promise<void> {
  await chrome.storage.local.remove(ERROR_STATE_KEY);
  logger.debug('Error state cleared');
}

/**
 * Mark error as dismissed (user acknowledged)
 */
export async function dismissError(): Promise<void> {
  const state = await getErrorState();
  if (state) {
    state.dismissed = true;
    await chrome.storage.local.set({ [ERROR_STATE_KEY]: state });
  }
}
