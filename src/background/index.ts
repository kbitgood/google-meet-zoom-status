/**
 * Background service worker entry point
 * Handles Zoom API calls, OAuth, and state management
 */

import type { ExtensionMessage, MeetingStateResponse, AuthStatusResponse } from '../types';

console.log('[Background] Service worker started');

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case 'MEETING_JOINED':
      console.log('[Background] Meeting joined:', message.meetingId);
      // TODO: Update Zoom status to Do_Not_Disturb
      sendResponse({ success: true });
      break;

    case 'MEETING_LEFT':
      console.log('[Background] Meeting left');
      // TODO: Update Zoom status to Available
      sendResponse({ success: true });
      break;

    case 'GET_MEETING_STATE':
      // TODO: Return actual meeting state from storage
      const stateResponse: MeetingStateResponse = {
        isInMeeting: false,
      };
      sendResponse(stateResponse);
      break;

    case 'GET_AUTH_STATUS':
      // TODO: Check actual auth status from storage
      const authResponse: AuthStatusResponse = {
        isAuthenticated: false,
      };
      sendResponse(authResponse);
      break;
  }

  // Return true to indicate async response
  return true;
});

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Background] Extension installed/updated:', details.reason);
});

// Handle service worker startup
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Service worker started up');
  // TODO: Restore meeting state from storage
});
