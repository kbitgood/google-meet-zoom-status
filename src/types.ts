/**
 * Shared type definitions for Google Meet to Zoom Status extension
 */

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
  | { type: 'GET_HAMMERSPOON_STATUS' };

// Response types for messages
export interface MeetingStateResponse {
  isInMeeting: boolean;
  meetingId?: string;
}

export interface HammerspoonStatusResponse {
  isConnected: boolean;
  zoomStatus?: string;
}

// Storage keys used throughout the extension
export const STORAGE_KEYS = {
  MEETING_STATE: 'meetingState',
  SETTINGS: 'settings',
} as const;

// Extension settings
export interface ExtensionSettings {
  autoUpdateStatus: boolean;
  showNotifications: boolean;
}

// Default settings
export const DEFAULT_SETTINGS: ExtensionSettings = {
  autoUpdateStatus: true,
  showNotifications: true,
};
