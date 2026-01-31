# AGENTS.md - Google Meet to Zoom Status Extension

## Project Overview

This is a Chrome extension (Manifest V3) that automatically updates your Zoom presence status when you join/leave Google Meet calls. It uses Hammerspoon (macOS automation) to control Zoom's native UI via accessibility APIs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Chrome Extension                            │
├─────────────────────────────────────────────────────────────────┤
│  src/                                                            │
│  ├── background/          # Service worker                      │
│  │   ├── index.ts        # Main entry, message handling         │
│  │   ├── hammerspoon-api.ts # HTTP client for Hammerspoon      │
│  │   └── meeting-state.ts # Track active meetings               │
│  ├── content/            # Content scripts (meet.google.com)    │
│  │   ├── index.ts       # Entry point                           │
│  │   └── meet-detector.ts # Meeting join/leave detection        │
│  ├── popup/              # Extension popup UI                   │
│  │   └── index.ts       # Popup logic                           │
│  ├── utils/              # Shared utilities                     │
│  │   ├── storage.ts     # Chrome storage helpers                │
│  │   ├── notifications.ts # User notifications                  │
│  │   └── logger.ts      # Logging utility                       │
│  └── types.ts            # Shared TypeScript types              │
├─────────────────────────────────────────────────────────────────┤
│  scripts/                                                        │
│  └── zoom_status.lua     # Hammerspoon module                   │
├─────────────────────────────────────────────────────────────────┤
│  public/                                                         │
│  ├── manifest.json       # Extension manifest                   │
│  ├── popup.html         # Popup HTML                            │
│  ├── popup.css          # Popup styles                          │
│  └── icons/             # Extension icons                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      Hammerspoon                                 │
├─────────────────────────────────────────────────────────────────┤
│  HTTP Server (localhost:17394)                                   │
│  ├── GET  /health        # Health check                         │
│  ├── GET  /status        # Get current Zoom status              │
│  ├── POST /meeting/join  # Set Busy + "In Google Meet"          │
│  └── POST /meeting/leave # Set Available + clear message        │
│                                                                  │
│  Zoom Control via Accessibility APIs                             │
│  └── Clicks UI elements, types text, navigates menus            │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
1. User joins Google Meet
   └─▶ Content script (meet-detector.ts) detects join via DOM observation
       └─▶ Sends message to background service worker
           └─▶ Background calls Hammerspoon API (POST /meeting/join)
               └─▶ Hammerspoon controls Zoom UI
                   └─▶ Zoom status changes to "Busy - In Google Meet"

2. User leaves Google Meet
   └─▶ Content script detects leave (button click, navigation, tab close)
       └─▶ Sends message to background service worker
           └─▶ Background calls Hammerspoon API (POST /meeting/leave)
               └─▶ Hammerspoon controls Zoom UI
                   └─▶ Zoom status changes to "Available"
```

## Key Technical Decisions

### Hammerspoon Instead of Zoom API

The Zoom REST API only supports setting presence status (Available/Away/DND), NOT custom status messages. To show "In Google Meet" as the status message, we control Zoom's native macOS UI via Hammerspoon's accessibility APIs.

Benefits:
- Custom status messages
- No OAuth setup
- No API rate limits (Zoom limits to ~100/day)
- Works offline
- No cloud dependencies

### Manifest V3

Required for Chrome Web Store. Uses service workers (not persistent background pages).

**Important**: Service workers can be terminated by the browser when idle - all critical state must be persisted to `chrome.storage.local`.

### Google Meet Detection Strategy

Content script runs on `meet.google.com/*` and uses MutationObserver to watch DOM:

1. **Join detected by**: presence of meeting controls (mute/camera buttons), meeting toolbar, absence of "Join" button
2. **Leave detected by**: 
   - Leave button click
   - Navigation away from meeting URL
   - Tab close
   - "You left the meeting" message

### HTTP Communication

The extension communicates with Hammerspoon via localhost HTTP:

```typescript
// POST requests require Content-Length header
fetch('http://localhost:17394/meeting/join', {
  method: 'POST',
  headers: { 'Content-Length': '0' }
})
```

## Hammerspoon Module Details

The `scripts/zoom_status.lua` module:

1. **Starts HTTP server** on port 17394 at load time
2. **Provides endpoints** for health check, status query, and meeting events
3. **Controls Zoom** via accessibility APIs:
   - Finds Zoom window
   - Clicks profile button
   - Navigates status menu
   - Sets status and custom message

### Zoom UI Automation Flow

```lua
1. Find Zoom main window
2. Click profile/status button (top-right area)
3. Wait for dropdown menu
4. Navigate to status option (Busy/Available)
5. If setting custom message:
   a. Click custom status option
   b. Clear existing text
   c. Type "In Google Meet"
   d. Click Save/Apply
```

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build extension to dist/
npm run build:watch  # Watch mode for development
npm run typecheck    # Run TypeScript type checking
```

## Loading Extension in Browser

1. Run `npm run build`
2. Open `chrome://extensions` (or `arc://extensions`)
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `dist/` folder

## Testing

### Test Hammerspoon Server

```bash
# Health check
curl http://localhost:17394/health

# Get current status
curl http://localhost:17394/status

# Simulate meeting join
curl -X POST -H "Content-Length: 0" http://localhost:17394/meeting/join

# Simulate meeting leave
curl -X POST -H "Content-Length: 0" http://localhost:17394/meeting/leave
```

### Reload Hammerspoon

```bash
hs -c 'hs.reload()'
```

### Test Meeting Detection

1. Open Chrome DevTools on a Google Meet tab
2. Look for `[MeetDetector]` log messages
3. Join/leave meetings and verify detection

## Important Gotchas

### Hammerspoon Accessibility Permissions

Hammerspoon needs accessibility permissions to control Zoom:
- System Settings > Privacy & Security > Accessibility
- Add Hammerspoon and enable

### Zoom Window Must Exist

The Zoom app must be running with its window accessible (can be minimized but not closed entirely).

### Service Worker Lifecycle

Chrome service workers are terminated when idle:
- Always persist critical state to `chrome.storage.local`
- Re-hydrate state in `onInstalled` and `onStartup` events
- Handle reconnection to Hammerspoon on wake

### HTTP POST Content-Length

Hammerspoon's HTTP server requires `Content-Length: 0` header for POST requests with no body - the extension sets this automatically.

## File Quick Reference

| File | Purpose |
|------|---------|
| `src/background/index.ts` | Service worker, message handling |
| `src/background/hammerspoon-api.ts` | HTTP client for Hammerspoon |
| `src/background/meeting-state.ts` | Track active meeting tabs |
| `src/content/meet-detector.ts` | Detect meeting join/leave |
| `src/popup/index.ts` | Extension popup UI |
| `scripts/zoom_status.lua` | Hammerspoon module |
| `public/manifest.json` | Extension manifest |
