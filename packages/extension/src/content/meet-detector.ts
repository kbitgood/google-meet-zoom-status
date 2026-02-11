/**
 * Google Meet Detection Module
 * Detects when user joins/leaves a Google Meet call using DOM observation
 */

import type { ExtensionMessage } from '../types';
import { contentLogger as logger } from '../utils/logger';

// Selectors for Google Meet UI elements
const SELECTORS = {
  // Meeting controls (present when in a meeting)
  MUTE_BUTTON: '[data-is-muted]',
  CAMERA_BUTTON: '[data-is-camera-on]',
  MEETING_CONTROLS: '[data-call-state]',
  CALL_CONTROLS_CONTAINER: 'div[jscontroller][jsaction*="mute"]',
  BOTTOM_BAR_BUTTONS: 'button[aria-label*="microphone"], button[aria-label*="camera"], button[aria-label*="Microphone"], button[aria-label*="Camera"]',
  
  // The red "Leave call" button is a strong indicator of being in a meeting
  END_CALL_BUTTON: 'button[aria-label*="Leave call"], button[aria-label="Leave call"]',
  
  // Pre-join elements (present before joining)
  JOIN_BUTTON: 'button[jsname="Qx7uuf"]', // "Join now" button
  ASK_TO_JOIN_BUTTON: 'button[data-idom-class*="join"]',
  JOIN_BUTTONS_CONTAINER: '[data-default-focus-start]',
  PRE_JOIN_SCREEN: '[data-call-state="not_started"]',
  
  // Leave indicators
  LEAVE_BUTTON: 'button[aria-label*="Leave"], button[aria-label*="leave"]',
  LEFT_MEETING_MESSAGE: '[data-call-ended="true"]',
  REJOIN_BUTTON: 'button[jsname="oI7Fj"]', // "Rejoin" button appears after leaving
  
  // Meeting info
  MEETING_INFO: '[data-meeting-code]',
  PARTICIPANT_COUNT: '[data-participant-count]',
} as const;

// Text patterns to detect meeting state
const TEXT_PATTERNS = {
  LEFT_MEETING: ['You left the meeting', "You've left the meeting", 'Call ended'],
  PRE_JOIN: ['Join now', 'Ask to join', 'Ready to join?', 'Joining...'],
  IN_MEETING: ['Present now', 'More options', 'Leave call'],
} as const;

export interface MeetingDetectorOptions {
  onJoin?: (meetingId?: string) => void;
  onLeave?: () => void;
  debug?: boolean;
}

export class MeetingDetector {
  private observer: MutationObserver | null = null;
  private isInMeeting = false;
  private meetingId: string | null = null;
  private options: MeetingDetectorOptions;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private tabId: number | null = null;
  private lastStateCheck = 0;
  private readonly STATE_CHECK_DEBOUNCE = 500; // ms

  constructor(options: MeetingDetectorOptions = {}) {
    this.options = options;
    this.extractMeetingId();
  }

  /**
   * Start observing the DOM for meeting state changes
   */
  start(): void {
    this.log('Starting meeting detector');
    
    // Initial state check
    this.checkMeetingState();
    
    // Set up MutationObserver for DOM changes
    this.observer = new MutationObserver(this.handleMutations.bind(this));
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-is-muted', 'data-call-state', 'aria-label', 'data-call-ended'],
    });

    // Periodic check as backup (Google Meet can be tricky)
    this.checkInterval = setInterval(() => {
      this.checkMeetingState();
    }, 2000);

    // Listen for navigation events (user navigates away)
    window.addEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    window.addEventListener('popstate', this.handleNavigation.bind(this));

    // Listen for visibility changes (tab switching)
    document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));

    this.log('Meeting detector started');
  }

  /**
   * Stop observing
   */
  stop(): void {
    this.log('Stopping meeting detector');
    
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    window.removeEventListener('beforeunload', this.handleBeforeUnload.bind(this));
    window.removeEventListener('popstate', this.handleNavigation.bind(this));
    document.removeEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
  }

  /**
   * Handle DOM mutations
   */
  private handleMutations(_mutations: MutationRecord[]): void {
    // Debounce state checks
    const now = Date.now();
    if (now - this.lastStateCheck < this.STATE_CHECK_DEBOUNCE) {
      return;
    }
    this.lastStateCheck = now;
    
    this.checkMeetingState();
  }

  /**
   * Main meeting state detection logic
   */
  private checkMeetingState(): void {
    const wasInMeeting = this.isInMeeting;
    const nowInMeeting = this.detectIfInMeeting();

    if (nowInMeeting && !wasInMeeting) {
      // User just joined
      this.isInMeeting = true;
      this.extractMeetingId();
      this.log('Detected meeting join', this.meetingId);
      this.notifyJoined();
    } else if (!nowInMeeting && wasInMeeting) {
      // User just left
      this.isInMeeting = false;
      this.log('Detected meeting leave');
      this.notifyLeft();
    }
  }

  /**
   * Determine if user is currently in a meeting
   */
  private detectIfInMeeting(): boolean {
    // Check for "left meeting" indicators first (highest priority)
    if (this.hasLeftMeetingIndicators()) {
      this.log('Found left meeting indicators');
      return false;
    }

    // Check for pre-join state (not yet in meeting)
    if (this.hasPreJoinIndicators()) {
      this.log('Found pre-join indicators');
      return false;
    }

    // Check for active meeting indicators
    if (this.hasActiveMeetingIndicators()) {
      this.log('Found active meeting indicators');
      return true;
    }

    // If no clear indicators, maintain current state
    return this.isInMeeting;
  }

  /**
   * Check for indicators that user has left the meeting
   */
  private hasLeftMeetingIndicators(): boolean {
    // Check for "left meeting" data attribute
    const leftElement = document.querySelector(SELECTORS.LEFT_MEETING_MESSAGE);
    if (leftElement) return true;

    // Check for rejoin button (appears after leaving)
    const rejoinButton = document.querySelector(SELECTORS.REJOIN_BUTTON);
    if (rejoinButton) return true;

    // Check for "left meeting" text patterns
    const bodyText = document.body.innerText;
    for (const pattern of TEXT_PATTERNS.LEFT_MEETING) {
      if (bodyText.includes(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for pre-join state indicators
   */
  private hasPreJoinIndicators(): boolean {
    // Check for pre-join screen
    const preJoinScreen = document.querySelector(SELECTORS.PRE_JOIN_SCREEN);
    if (preJoinScreen) return true;

    // Check for join buttons
    const joinButton = document.querySelector(SELECTORS.JOIN_BUTTON);
    const askToJoinButton = document.querySelector(SELECTORS.ASK_TO_JOIN_BUTTON);
    if (joinButton || askToJoinButton) return true;

    // Check for join button text
    const buttons = document.querySelectorAll('button');
    for (const button of buttons) {
      const text = button.textContent?.trim() || '';
      if (text === 'Join now' || text === 'Ask to join') {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for active meeting indicators
   */
  private hasActiveMeetingIndicators(): boolean {
    // Check for the red "Leave call" button - this is the most reliable indicator
    const endCallButton = document.querySelector(SELECTORS.END_CALL_BUTTON);
    if (endCallButton) {
      this.log('Found end call button');
      return true;
    }

    // Check for mute/camera buttons with state
    const muteButton = document.querySelector(SELECTORS.MUTE_BUTTON);
    const cameraButton = document.querySelector(SELECTORS.CAMERA_BUTTON);
    if (muteButton || cameraButton) return true;

    // Check for meeting controls container
    const meetingControls = document.querySelector(SELECTORS.MEETING_CONTROLS);
    if (meetingControls) {
      const state = meetingControls.getAttribute('data-call-state');
      if (state && state !== 'not_started' && state !== 'ended') {
        return true;
      }
    }

    // Check for bottom bar control buttons (mic/camera)
    const bottomBarButtons = document.querySelectorAll(SELECTORS.BOTTOM_BAR_BUTTONS);
    if (bottomBarButtons.length >= 2) {
      this.log('Found bottom bar buttons:', bottomBarButtons.length);
      return true;
    }

    // Check for leave button (only present during active call)
    const leaveButton = document.querySelector(SELECTORS.LEAVE_BUTTON);
    if (leaveButton) return true;

    // Check for "in meeting" text patterns
    const bodyText = document.body.innerText;
    let matchCount = 0;
    for (const pattern of TEXT_PATTERNS.IN_MEETING) {
      if (bodyText.includes(pattern)) {
        matchCount++;
      }
    }
    // Need at least 2 patterns to be confident
    if (matchCount >= 2) return true;

    return false;
  }

  /**
   * Extract meeting ID from URL
   */
  private extractMeetingId(): void {
    const url = window.location.href;
    
    // Match patterns like:
    // https://meet.google.com/abc-defg-hij
    // https://meet.google.com/abc-defg-hij?authuser=0
    const match = url.match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    
    if (match) {
      this.meetingId = match[1];
    } else {
      // Try alternative format (just the path)
      const pathMatch = window.location.pathname.match(/^\/([a-z-]+)$/i);
      if (pathMatch && pathMatch[1].includes('-')) {
        this.meetingId = pathMatch[1];
      }
    }
  }

  /**
   * Send MEETING_JOINED message to background script
   */
  private notifyJoined(): void {
    if (this.options.onJoin) {
      this.options.onJoin(this.meetingId ?? undefined);
    }

    const message: ExtensionMessage = {
      type: 'MEETING_JOINED',
      meetingId: this.meetingId ?? undefined,
      tabId: this.tabId ?? 0,
    };

    chrome.runtime.sendMessage(message).catch((err) => {
      this.log('Failed to send MEETING_JOINED message:', err);
    });
  }

  /**
   * Send MEETING_LEFT message to background script
   */
  private notifyLeft(): void {
    if (this.options.onLeave) {
      this.options.onLeave();
    }

    const message: ExtensionMessage = {
      type: 'MEETING_LEFT',
      tabId: this.tabId ?? 0,
    };

    chrome.runtime.sendMessage(message).catch((err) => {
      this.log('Failed to send MEETING_LEFT message:', err);
    });
  }

  /**
   * Handle page unload (closing tab or navigating away)
   */
  private handleBeforeUnload(_event: BeforeUnloadEvent): void {
    if (this.isInMeeting) {
      this.log('Page unloading while in meeting');
      // Try to notify background script (may not succeed due to unload)
      this.notifyLeft();
    }
  }

  /**
   * Handle navigation (popstate)
   */
  private handleNavigation(): void {
    // Re-extract meeting ID in case URL changed
    const oldMeetingId = this.meetingId;
    this.extractMeetingId();

    if (this.meetingId !== oldMeetingId && this.isInMeeting) {
      this.log('Navigation detected while in meeting');
      this.checkMeetingState();
    }
  }

  /**
   * Handle visibility changes (tab focus)
   */
  private handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      // Recheck state when tab becomes visible
      this.checkMeetingState();
    }
  }

  /**
   * Set the tab ID for this detector instance
   */
  setTabId(tabId: number): void {
    this.tabId = tabId;
  }

  /**
   * Get current meeting state
   */
  getState(): { isInMeeting: boolean; meetingId: string | null } {
    return {
      isInMeeting: this.isInMeeting,
      meetingId: this.meetingId,
    };
  }

  /**
   * Force a state check (useful for initialization)
   */
  forceCheck(): void {
    this.checkMeetingState();
  }

  /**
   * Log helper
   */
  private log(...args: unknown[]): void {
    // Always log for now to debug the issue
    const message = args.map(arg => 
      typeof arg === 'string' ? arg : JSON.stringify(arg)
    ).join(' ');
    logger.debug(message);
    console.log('[MeetDetector]', ...args);
  }
}

/**
 * Create and start a MeetingDetector instance
 */
export function createMeetingDetector(options: MeetingDetectorOptions = {}): MeetingDetector {
  const detector = new MeetingDetector({
    debug: true, // Enable debug logging by default for now
    ...options,
  });
  detector.start();
  return detector;
}
