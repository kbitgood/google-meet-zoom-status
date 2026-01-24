# Integration Testing Guide

This document provides comprehensive testing instructions for the Google Meet to Zoom Status Chrome extension. Follow these tests to verify the complete extension flow works correctly.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Loading the Extension](#loading-the-extension)
3. [Test Cases](#test-cases)
   - [OAuth Flow Testing](#oauth-flow-testing)
   - [Meeting Detection Testing](#meeting-detection-testing)
   - [Status Update Timing](#status-update-timing)
   - [Multiple Tab Scenarios](#multiple-tab-scenarios)
   - [Error Recovery Scenarios](#error-recovery-scenarios)
4. [Acceptance Criteria Checklist](#acceptance-criteria-checklist)
5. [Known Issues and Limitations](#known-issues-and-limitations)
6. [Debugging Tips](#debugging-tips)

---

## Prerequisites

Before testing, ensure you have:

1. **Zoom OAuth App configured** (see [ZOOM_OAUTH_SETUP.md](./ZOOM_OAUTH_SETUP.md))
2. **Config file created**: Copy `src/config.example.ts` to `src/config.ts` and fill in your Zoom credentials
3. **Extension built**: Run `npm run build`
4. **Chrome/Arc browser** with Developer Mode enabled

## Loading the Extension

1. Open `chrome://extensions` (or `arc://extensions` for Arc browser)
2. Enable "Developer mode" toggle (top right)
3. Click "Load unpacked"
4. Select the `dist/` folder in this project
5. Note the **Extension ID** (you'll need this for the OAuth redirect URI)

---

## Test Cases

### OAuth Flow Testing

#### Test 1.1: Initial Connection (Happy Path)

**Steps:**
1. Click the extension icon to open the popup
2. Verify popup shows "Not connected" status
3. Click "Connect to Zoom" button
4. Observe OAuth popup opens
5. Log in to Zoom (if not already)
6. Authorize the application
7. Popup closes automatically

**Expected Results:**
- OAuth popup opens to Zoom authorization page
- After authorization, popup closes automatically
- Extension popup shows "Connected" status with green indicator
- Extension badge turns green

**Timing Expectation:** OAuth flow should complete within 30 seconds (excluding user login time)

---

#### Test 1.2: User Cancels OAuth

**Steps:**
1. Click "Connect to Zoom" button
2. When OAuth popup appears, close it manually (X button)

**Expected Results:**
- No error notification appears
- Popup returns to "Not connected" state
- No error banner in popup

---

#### Test 1.3: Disconnect from Zoom

**Steps:**
1. Ensure you're connected to Zoom
2. Click "Disconnect" button

**Expected Results:**
- Status changes to "Not connected"
- Badge turns gray
- "Connect to Zoom" button appears

---

#### Test 1.4: Reconnect After Disconnect

**Steps:**
1. Disconnect from Zoom (Test 1.3)
2. Click "Connect to Zoom" again
3. Complete OAuth flow

**Expected Results:**
- OAuth flow works correctly
- Connection is re-established
- Previous meeting state is cleared

---

#### Test 1.5: Token Refresh (Long Duration)

**Steps:**
1. Connect to Zoom
2. Leave browser open for > 55 minutes (token expires in 1 hour)
3. Verify connection status in popup

**Expected Results:**
- Token is automatically refreshed
- No user action required
- Connection remains active
- Check service worker logs for refresh message

---

### Meeting Detection Testing

#### Test 2.1: Join Meeting Detection

**Steps:**
1. Ensure connected to Zoom
2. Open Google Meet: https://meet.google.com
3. Create or join a meeting
4. Click "Join now" button

**Expected Results:**
- Meeting join detected within 5 seconds of clicking "Join now"
- Extension badge shows red "MTG" indicator
- Popup shows "In a meeting" status
- Zoom status changes to "Do Not Disturb" (verify in Zoom client or web)

**Timing Verification:**
- Open DevTools on the Meet tab (F12 > Console)
- Look for `[MeetDetector] Detected meeting join` message
- Note timestamp and compare to when you clicked Join

---

#### Test 2.2: Leave Meeting Detection

**Steps:**
1. While in a meeting, click "Leave call" button
2. Confirm leaving if prompted

**Expected Results:**
- Meeting leave detected within 5 seconds
- Extension badge returns to green (no text)
- Popup shows "Not in a meeting" status
- Zoom status restores to previous value (usually "Available")

---

#### Test 2.3: Pre-Join Screen Detection

**Steps:**
1. Navigate to a meeting link (e.g., `meet.google.com/abc-defg-hij`)
2. Wait on the pre-join screen (camera/mic preview)
3. Do NOT click "Join now"

**Expected Results:**
- No meeting join detected
- Badge remains green (not red "MTG")
- Zoom status unchanged

---

#### Test 2.4: Meeting Detection After Page Refresh

**Steps:**
1. Join a meeting
2. Refresh the page (F5 or Cmd+R)
3. Rejoin the meeting

**Expected Results:**
- Original meeting leave is detected (brief status restore)
- New meeting join is detected
- Status correctly shows "Do Not Disturb"

---

### Status Update Timing

#### Test 3.1: Status Update Speed on Join

**Steps:**
1. Open Zoom client or Zoom web to see your current status
2. Note your current status (e.g., "Available")
3. Join a Google Meet
4. Time how long until Zoom status changes to "Do Not Disturb"

**Expected Results:**
- Status updates within 5 seconds of meeting join detection
- Total time from "Join now" click to Zoom status change: < 10 seconds

---

#### Test 3.2: Status Restore Speed on Leave

**Steps:**
1. While in a meeting (status = DND)
2. Note the time
3. Click "Leave call"
4. Time how long until Zoom status restores

**Expected Results:**
- Status restores within 5 seconds of meeting leave detection
- Total time from "Leave call" click to status restore: < 10 seconds

---

#### Test 3.3: Previous Status Preservation

**Steps:**
1. Set Zoom status to "Away" manually before testing
2. Join a Google Meet
3. Status should change to "Do Not Disturb"
4. Leave the meeting
5. Check Zoom status

**Expected Results:**
- Status is restored to "Away" (not "Available")
- Extension correctly remembers the status before meeting

---

### Multiple Tab Scenarios

#### Test 4.1: Multiple Meeting Tabs

**Steps:**
1. Join a meeting in Tab 1
2. Verify status changes to DND
3. Open a second meeting in Tab 2
4. Close Tab 1

**Expected Results:**
- Status remains "Do Not Disturb" (Tab 2 still in meeting)
- Badge shows "MTG"
- Only when Tab 2 is closed/left does status restore

---

#### Test 4.2: Tab Close During Meeting

**Steps:**
1. Join a meeting
2. Close the tab (X button) instead of leaving properly

**Expected Results:**
- Extension detects tab close
- Status restores to previous value within 5 seconds
- Badge returns to green

---

#### Test 4.3: Window Close During Meeting

**Steps:**
1. Join a meeting
2. Close the entire browser window

**Expected Results:**
- On next browser launch, status should be restored
- Crash recovery logic handles stale meeting state

---

#### Test 4.4: Navigate Away from Meet

**Steps:**
1. Join a meeting
2. Navigate to a different URL in the same tab (e.g., google.com)

**Expected Results:**
- Extension detects navigation away from Meet
- Treated as "meeting left"
- Status restores

---

### Error Recovery Scenarios

#### Test 5.1: Network Error During Status Update

**Steps:**
1. Connect to Zoom
2. Disable network (airplane mode)
3. Join a meeting
4. Re-enable network

**Expected Results:**
- Error notification appears about network issue
- Extension continues to function
- Status update will be attempted on next meeting event

---

#### Test 5.2: Token Expiry During Meeting

**Steps:**
1. Connect to Zoom
2. Wait for token to expire (or manually clear token from storage)
3. Join/leave a meeting

**Expected Results:**
- "Session expired" notification appears
- Popup shows warning about expired session
- User can reconnect via popup or notification

---

#### Test 5.3: Zoom API Rate Limiting

**Steps:**
1. Rapidly join/leave meetings (or use dev tools to trigger API calls)
2. Exceed rate limit (~100 requests/day for presence)

**Expected Results:**
- Extension handles 429 errors gracefully
- Exponential backoff applied
- Status eventually updates when rate limit clears

---

#### Test 5.4: Browser Restart Recovery

**Steps:**
1. Join a meeting
2. Force quit the browser (not normal close)
3. Reopen browser

**Expected Results:**
- Extension detects stale meeting state
- Zoom status is restored to previous value
- No lingering "Do Not Disturb" status

---

## Acceptance Criteria Checklist

Use this checklist to verify all acceptance criteria are met:

| Criteria | Status | Notes |
|----------|--------|-------|
| OAuth flow works end-to-end | [ ] | Test 1.1 |
| Meeting join detected within 5 seconds | [ ] | Test 2.1 |
| Status updates within 5 seconds of meeting join | [ ] | Test 3.1 |
| Status restores within 5 seconds of meeting leave | [ ] | Test 3.2 |
| Multiple tabs work correctly | [ ] | Tests 4.1-4.4 |
| Tab close resets status | [ ] | Test 4.2 |
| Error recovery works | [ ] | Tests 5.1-5.4 |
| `npm run typecheck` passes | [ ] | Run before commit |
| `npm run build` succeeds | [ ] | Run before commit |

---

## Known Issues and Limitations

### Google Meet DOM Changes

Google Meet's DOM structure can change with updates. The meeting detection uses multiple strategies:
1. Data attributes (`data-is-muted`, `data-call-state`)
2. ARIA labels on buttons
3. Text content patterns ("Present now", "Leave call")
4. Button presence (mute, camera, leave)

If detection fails after a Google Meet update, check `src/content/meet-detector.ts` and update selectors.

### Zoom API Rate Limits

- Presence status endpoint: ~100 updates per day
- Extension implements exponential backoff
- Excessive meeting joins/leaves may hit limits

### Service Worker Lifecycle

Chrome service workers are terminated when idle. The extension:
- Persists all state to `chrome.storage.local`
- Re-initializes on service worker restart
- Handles crash recovery

### Token Refresh Timing

- Tokens expire in 1 hour
- Refresh scheduled 5 minutes before expiry
- If service worker is terminated, refresh happens on next wake

---

## Debugging Tips

### View Service Worker Logs

1. Go to `chrome://extensions`
2. Find the extension
3. Click "service worker" link (under "Inspect views")
4. View Console tab for logs

### View Content Script Logs

1. Open a Google Meet page
2. Open DevTools (F12)
3. Look for `[MeetDetector]` and `[Content]` messages

### Check Storage State

In the service worker DevTools console:
```javascript
// View all extension storage
chrome.storage.local.get(null, console.log)

// Check meeting state
chrome.storage.local.get('meetingStateData', console.log)

// Check Zoom token
chrome.storage.local.get('zoomToken', console.log)

// Check error state
chrome.storage.local.get('lastErrorState', console.log)
```

### Force Token Refresh

In service worker DevTools:
```javascript
// Clear token to test re-auth
chrome.storage.local.remove('zoomToken')
```

### Reset All Extension State

In service worker DevTools:
```javascript
// Complete reset
chrome.storage.local.clear()
```

### Test Meeting Detection Manually

In content script DevTools (on a Meet page):
```javascript
// Force a state check
detector?.forceCheck()

// View current state
detector?.getState()
```

---

## Manual Testing Log

Use this template to log your testing sessions:

```
Date: YYYY-MM-DD
Tester: Name
Browser: Chrome/Arc Version X.X
Extension Version: 1.0.0

Test Results:
- Test 1.1 (OAuth Happy Path): PASS/FAIL - Notes
- Test 1.2 (User Cancel): PASS/FAIL - Notes
- ...

Issues Found:
- Issue 1: Description, Steps to Reproduce
- Issue 2: Description, Steps to Reproduce

Overall Status: READY/NOT READY for release
```
