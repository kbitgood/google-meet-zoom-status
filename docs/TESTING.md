# Testing Guide

This document provides testing instructions for the Google Meet to Zoom Status Chrome extension.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup Verification](#setup-verification)
3. [Test Cases](#test-cases)
   - [Hammerspoon Connection](#hammerspoon-connection)
   - [Meeting Detection](#meeting-detection)
   - [Status Updates](#status-updates)
   - [Multiple Tab Scenarios](#multiple-tab-scenarios)
   - [Error Handling](#error-handling)
4. [Debugging Tips](#debugging-tips)

---

## Prerequisites

Before testing, ensure you have:

1. **Hammerspoon installed** and running
2. **zoom_status module loaded** in Hammerspoon
3. **Accessibility permissions** granted to Hammerspoon
4. **Zoom desktop app** installed and signed in
5. **Extension built**: Run `npm run build`
6. **Extension loaded** in Chrome

## Setup Verification

### 1. Verify Hammerspoon Server

```bash
# Health check - should return success
curl http://localhost:17394/health
# Expected: {"success":true,"service":"zoom-status","version":"1.0"}

# Status check - should return current Zoom status
curl http://localhost:17394/status
# Expected: {"success":true,"status":"Available"}
```

### 2. Verify Extension Loaded

1. Open `chrome://extensions`
2. Find "Google Meet to Zoom Status"
3. Ensure it's enabled (toggle is blue)

### 3. Verify Popup Shows Connected

1. Click the extension icon
2. Should show "Hammerspoon: Connected"
3. Should show current Zoom status

---

## Test Cases

### Hammerspoon Connection

#### Test 1.1: Connection Status

**Steps:**
1. Ensure Hammerspoon is running with zoom_status module
2. Click extension icon

**Expected:**
- Popup shows "Hammerspoon: Connected" with green indicator
- Current Zoom status is displayed

#### Test 1.2: Disconnected State

**Steps:**
1. Quit Hammerspoon (or stop the HTTP server)
2. Click extension icon

**Expected:**
- Popup shows "Hammerspoon: Not running" with gray indicator
- Zoom status shows "-"

#### Test 1.3: Reconnection

**Steps:**
1. With Hammerspoon stopped, open the popup
2. Start Hammerspoon
3. Wait 5 seconds or reopen popup

**Expected:**
- Status updates to "Connected"

---

### Meeting Detection

#### Test 2.1: Join Meeting Detection

**Steps:**
1. Ensure Hammerspoon is running
2. Open Google Meet: https://meet.google.com
3. Create or join a meeting
4. Click "Join now" button

**Expected:**
- Meeting join detected within 5 seconds
- Popup shows "Meeting Status: In a meeting"
- Zoom status changes to "Busy" with message "In Google Meet"

**Verification:**
- Open DevTools on the Meet tab (F12 > Console)
- Look for `[MeetDetector] Detected meeting join` message

#### Test 2.2: Leave Meeting Detection

**Steps:**
1. While in a meeting, click "Leave call" button
2. Confirm leaving if prompted

**Expected:**
- Meeting leave detected within 5 seconds
- Popup shows "Meeting Status: Not in a meeting"
- Zoom status returns to "Available"

#### Test 2.3: Pre-Join Screen (Negative Test)

**Steps:**
1. Navigate to a meeting link
2. Stay on the pre-join screen (camera/mic preview)
3. Do NOT click "Join now"

**Expected:**
- No meeting join detected
- Zoom status remains unchanged

---

### Status Updates

#### Test 3.1: Manual Status Test via curl

**Steps:**
```bash
# Set status to "in meeting"
curl -X POST -H "Content-Length: 0" http://localhost:17394/meeting/join

# Check Zoom app - should show Busy + "In Google Meet"

# Set status back to available
curl -X POST -H "Content-Length: 0" http://localhost:17394/meeting/leave

# Check Zoom app - should show Available
```

**Expected:**
- Zoom status updates within 5 seconds of each command
- Custom status message "In Google Meet" appears when busy

#### Test 3.2: Status Update Timing

**Steps:**
1. Open Zoom desktop app to see your status
2. Join a Google Meet
3. Time how long until Zoom status changes

**Expected:**
- Status updates within 10 seconds of clicking "Join now"

---

### Multiple Tab Scenarios

#### Test 4.1: Multiple Meeting Tabs

**Steps:**
1. Join a meeting in Tab 1
2. Verify Zoom status is "Busy"
3. Open a second meeting in Tab 2
4. Close Tab 1

**Expected:**
- Status remains "Busy" (Tab 2 still in meeting)
- Only when Tab 2 is closed does status restore

#### Test 4.2: Tab Close During Meeting

**Steps:**
1. Join a meeting
2. Close the tab (X button) instead of leaving properly

**Expected:**
- Extension detects tab close
- Status restores to "Available" within 5 seconds

#### Test 4.3: Navigate Away from Meet

**Steps:**
1. Join a meeting
2. Navigate to a different URL in the same tab

**Expected:**
- Extension detects navigation away
- Status restores to "Available"

---

### Error Handling

#### Test 5.1: Hammerspoon Not Running

**Steps:**
1. Quit Hammerspoon
2. Join a Google Meet

**Expected:**
- Extension gracefully handles connection failure
- No crash or error popup
- Popup shows "Hammerspoon: Not running"

#### Test 5.2: Zoom App Not Running

**Steps:**
1. Quit Zoom
2. Join a Google Meet

**Expected:**
- Hammerspoon receives request but can't control Zoom
- Check Hammerspoon console for error message
- Extension continues to function

---

## Debugging Tips

### View Service Worker Logs

1. Go to `chrome://extensions`
2. Find the extension
3. Click "service worker" link
4. View Console tab for logs

### View Content Script Logs

1. Open a Google Meet page
2. Open DevTools (F12)
3. Look for `[MeetDetector]` messages

### View Hammerspoon Console

1. Click Hammerspoon menubar icon
2. Select "Console"
3. Look for `[ZoomStatus]` messages

### Check Extension Storage

In the service worker DevTools console:
```javascript
// View all extension storage
chrome.storage.local.get(null, console.log)

// Check meeting state
chrome.storage.local.get('meetingState', console.log)
```

### Test Hammerspoon Module Directly

```bash
# Health check
curl http://localhost:17394/health

# Get status
curl http://localhost:17394/status

# Simulate join
curl -X POST -H "Content-Length: 0" http://localhost:17394/meeting/join

# Simulate leave
curl -X POST -H "Content-Length: 0" http://localhost:17394/meeting/leave
```

### Reload Hammerspoon

```bash
hs -c 'hs.reload()'
```

### Reset Extension State

In service worker DevTools:
```javascript
chrome.storage.local.clear()
```

---

## Acceptance Criteria Checklist

| Criteria | Status | Notes |
|----------|--------|-------|
| Hammerspoon connection detected | [ ] | Test 1.1 |
| Meeting join detected within 5 seconds | [ ] | Test 2.1 |
| Zoom status updates on join | [ ] | Test 3.1 |
| Zoom status restores on leave | [ ] | Test 2.2 |
| Multiple tabs work correctly | [ ] | Test 4.1 |
| Tab close resets status | [ ] | Test 4.2 |
| Handles Hammerspoon not running | [ ] | Test 5.1 |
| `npm run typecheck` passes | [ ] | Run before commit |
| `npm run build` succeeds | [ ] | Run before commit |

---

## Manual Testing Log

Use this template to log testing sessions:

```
Date: YYYY-MM-DD
Tester: Name
Browser: Chrome/Arc Version X.X
Extension Version: 1.0.0
Hammerspoon Version: X.X.X

Test Results:
- Test 1.1 (Connection): PASS/FAIL - Notes
- Test 2.1 (Join Detection): PASS/FAIL - Notes
- ...

Issues Found:
- Issue 1: Description, Steps to Reproduce

Overall Status: READY/NOT READY
```
