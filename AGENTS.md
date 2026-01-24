# AGENTS.md - Google Meet to Zoom Status Extension

## Project Overview

This is a Chrome extension (Manifest V3) that automatically updates your Zoom presence status when you join/leave Google Meet calls.

## Architecture

```
src/
├── background/          # Service worker (Zoom API, state management)
│   ├── index.ts        # Main service worker entry
│   ├── zoom-auth.ts    # OAuth flow handling
│   ├── zoom-api.ts     # Zoom API calls
│   └── meeting-state.ts # Track active meetings
├── content/            # Content scripts (runs on meet.google.com)
│   ├── index.ts       # Entry point
│   └── meet-detector.ts # Meeting join/leave detection
├── popup/              # Extension popup UI
│   ├── index.ts       # Popup logic
│   └── popup.css      # Styles
├── utils/              # Shared utilities
│   ├── storage.ts     # Chrome storage helpers
│   ├── notifications.ts # User notifications
│   └── logger.ts      # Logging utility
└── types.ts            # Shared TypeScript types

public/
├── manifest.json       # Extension manifest
├── popup.html         # Popup HTML
└── icons/             # Extension icons
```

## Key Technical Decisions

### Manifest V3
- Required for Chrome Web Store
- Uses service workers (not persistent background pages)
- Service workers can be terminated by browser - must persist state

### OAuth via launchWebAuthFlow
- Chrome's recommended approach for OAuth in extensions
- Redirect URI format: `https://<extension-id>.chromiumapp.org/`
- Tokens stored in `chrome.storage.local`

### Google Meet Detection Strategy
1. Content script runs on `meet.google.com/*`
2. Uses MutationObserver to watch DOM changes
3. Join detected by: presence of meeting controls, absence of join buttons
4. Leave detected by: leave button click, navigation, or "You left" message

### Zoom API
- Base URL: `https://api.zoom.us/v2`
- Presence endpoint: `PUT /users/{userId}/presence_status`
- Status values: `Available`, `Away`, `Do_Not_Disturb`
- Rate limit: ~100 requests/day for presence status

## Important Gotchas

### Service Worker Lifecycle
- Service workers are terminated when idle
- Always persist critical state to `chrome.storage.local`
- Re-hydrate state in service worker `onInstalled` and `onStartup`

### Chrome Extension Permissions
- `identity` - for OAuth flow
- `storage` - for persisting tokens/state
- `tabs` - for detecting tab close
- Host permissions for `meet.google.com` and `api.zoom.us`

### Token Refresh
- Zoom access tokens expire in 1 hour
- Must refresh BEFORE expiry to avoid failed API calls
- Store `expires_at` timestamp and check before each API call

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

- Test OAuth flow with a real Zoom account
- Test meeting detection on actual Google Meet calls
- Test tab close scenarios
- Check Chrome DevTools > Service Worker for background logs
