# Privacy Policy

**Google Meet to Zoom Status**  
*Last Updated: February 11, 2026*

## Overview

Google Meet to Zoom Status is a Chrome extension that detects Google Meet join/leave activity and triggers a local Zoom automation service running on your machine.

This project does not send your meeting data to third-party servers controlled by this extension.

## How It Works

The system has two local components:

1. **Chrome Extension**: Detects whether you are currently in a Google Meet call.
2. **Zoom Automator (Bun + Playwright)**: Runs on `localhost:17394` and controls `https://app.zoom.us` in a local browser profile to start/end one private meeting.

## Data Collection

### What we collect remotely

None.

This project does not transmit your meeting metadata/content to external servers owned by this project.

### What is stored locally

| Data Type | Where | Purpose |
|-----------|-------|---------|
| Meeting tab state | `chrome.storage.local` | Track active Google Meet tabs |
| Zoom web session profile (cookies/session/local storage) | Local Playwright profile directory on your machine | Keep you logged in after one-time MFA |

### What we do not collect

- Meeting audio/video/chat content
- Google account credentials
- Zoom account credentials (credentials are entered directly into Zoom pages)
- Browsing history outside required pages

## Local and Third-Party Traffic

- Extension <-> Zoom Automator traffic is local (`localhost`) only.
- Zoom Automator communicates with Zoom web endpoints (`app.zoom.us`) to sign in and run meetings.
- This is required for Zoom functionality and uses your own Zoom account session.

## Permissions

The extension requests:

| Permission | Reason |
|------------|--------|
| `storage` | Persist meeting state |
| `tabs` | Handle tab close/navigation state |
| `activeTab` | Operate on active Meet tabs |
| `host_permissions` for `https://meet.google.com/*` | Detect Meet join/leave |
| `host_permissions` for `http://localhost:17394/*` | Call local Zoom Automator |

## Data Retention

- Extension state persists locally until cleared or extension uninstall.
- Zoom web profile data persists locally until you delete the profile directory or sign out.

## Security Notes

- Localhost traffic is unencrypted by default but does not leave your machine.
- Access to local profile data is governed by your OS account permissions.

## Your Controls

- Disable/uninstall extension at any time.
- Stop the local Zoom Automator server at any time.
- Delete local profile/session files at any time.

## Contact

For issues or questions, open an issue in the project repository.
