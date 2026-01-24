/**
 * Content script entry point
 * Runs on meet.google.com to detect meeting join/leave events
 */

import { createMeetingDetector, MeetingDetector } from './meet-detector';
import { contentLogger as logger } from '../utils/logger';

logger.info('Google Meet content script loaded');

let detector: MeetingDetector | null = null;

/**
 * Initialize the meeting detector
 */
function initialize(): void {
  // Don't initialize if already running
  if (detector) {
    logger.debug('Detector already initialized');
    return;
  }

  // Only initialize on actual meeting pages
  if (!isMeetingPage()) {
    logger.debug('Not a meeting page, skipping initialization');
    return;
  }

  logger.info('Initializing meeting detector');

  detector = createMeetingDetector({
    debug: true,
    onJoin: (meetingId) => {
      logger.info('Meeting joined callback', { meetingId });
    },
    onLeave: () => {
      logger.info('Meeting left callback');
    },
  });

  // Try to get the current tab ID
  chrome.runtime.sendMessage({ type: 'GET_MEETING_STATE' })
    .then(() => {
      // Tab ID will be set by background script via sender info
      logger.debug('Connected to background script');
    })
    .catch((err) => {
      logger.warn('Failed to connect to background script', { error: err?.message });
    });
}

/**
 * Check if current page is a meeting page (not just meet.google.com home)
 */
function isMeetingPage(): boolean {
  const path = window.location.pathname;
  
  // Meeting pages have a meeting code in the path
  // Format: /abc-defg-hij or similar
  if (path === '/' || path === '') {
    return false;
  }

  // Check for known non-meeting paths
  const nonMeetingPaths = ['/landing', '/whoops', '/about', '/terms', '/privacy'];
  if (nonMeetingPaths.some(p => path.startsWith(p))) {
    return false;
  }

  // Likely a meeting page
  return true;
}

/**
 * Handle cleanup when content script is unloaded
 */
function cleanup(): void {
  if (detector) {
    detector.stop();
    detector = null;
    logger.debug('Detector stopped');
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  // DOM already loaded
  initialize();
}

// Cleanup on unload
window.addEventListener('unload', cleanup);

// Also handle page visibility for potential reconnection scenarios
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !detector && isMeetingPage()) {
    // Re-initialize if detector was stopped
    initialize();
  }
});

// Export for potential testing
export { detector, initialize, cleanup };
