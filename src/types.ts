/**
 * Shared type definitions for Google Meet to Zoom Status extension
 */

// Zoom presence status values
export type ZoomPresenceStatus = 'Available' | 'Away' | 'Do_Not_Disturb';

// OAuth token data stored in chrome.storage
export interface ZoomTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  userId: string;
}

// Meeting state tracked by the extension
export interface MeetingState {
  isInMeeting: boolean;
  meetingId?: string;
  joinedAt?: number; // Unix timestamp
  tabId?: number;
}

// Messages between content script and background
export type ExtensionMessage =
  | { type: 'MEETING_JOINED'; meetingId?: string; tabId: number }
  | { type: 'MEETING_LEFT'; tabId: number }
  | { type: 'GET_MEETING_STATE' }
  | { type: 'GET_AUTH_STATUS' };

// Response types for messages
export interface MeetingStateResponse {
  isInMeeting: boolean;
  meetingId?: string;
}

export interface AuthStatusResponse {
  isAuthenticated: boolean;
  userId?: string;
}

// Storage keys used throughout the extension
export const STORAGE_KEYS = {
  ZOOM_TOKEN: 'zoomToken',
  MEETING_STATE: 'meetingState',
  SETTINGS: 'settings',
} as const;

// Extension settings
export interface ExtensionSettings {
  autoUpdateStatus: boolean;
  inMeetingStatus: ZoomPresenceStatus;
  afterMeetingStatus: ZoomPresenceStatus;
  showNotifications: boolean;
}

// Default settings
export const DEFAULT_SETTINGS: ExtensionSettings = {
  autoUpdateStatus: true,
  inMeetingStatus: 'Do_Not_Disturb',
  afterMeetingStatus: 'Available',
  showNotifications: true,
};
