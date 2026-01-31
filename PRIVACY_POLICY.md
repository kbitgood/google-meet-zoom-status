# Privacy Policy

**Google Meet to Zoom Status**  
*Last Updated: January 31, 2026*

## Overview

Google Meet to Zoom Status is a Chrome browser extension that automatically updates your Zoom presence status when you join or leave Google Meet video calls. This extension operates entirely locally on your Mac - no data is transmitted to external servers.

## How It Works

The extension uses a two-part system:

1. **Chrome Extension**: Detects when you join/leave Google Meet calls
2. **Hammerspoon** (local macOS automation): Controls the Zoom desktop app via accessibility APIs

All communication happens locally on your machine via `localhost`.

## Data Collection

### What We Collect

**Nothing.** This extension does not collect, store, or transmit any personal data to external servers.

### What Is Stored Locally

The extension stores minimal data locally on your device using Chrome's storage:

| Data Type | Purpose | Storage |
|-----------|---------|---------|
| Meeting state | Track if you're in a Google Meet call | Chrome local storage |
| Extension settings | User preferences | Chrome local storage |

### What We Do NOT Collect

- We do NOT collect personal information (name, email, etc.)
- We do NOT collect meeting content, audio, video, or chat
- We do NOT collect browsing history
- We do NOT track which meetings you attend
- We do NOT collect Google account information
- We do NOT collect Zoom account information
- We do NOT transmit any data to external servers

## No External Services

Unlike the previous version that used Zoom's OAuth API, this extension:

- Does NOT connect to Zoom's API servers
- Does NOT require OAuth authentication
- Does NOT store authentication tokens
- Does NOT communicate with any cloud services

All Zoom control happens locally via Hammerspoon's accessibility APIs.

## Third-Party Services

### Google Meet

The extension runs a content script on Google Meet pages (`meet.google.com`) solely to detect meeting join/leave events. It does NOT:
- Access your Google account
- Read meeting content
- Record any meeting data

### Hammerspoon

The extension communicates with Hammerspoon via `localhost:17394`. Hammerspoon is a separate macOS application that runs locally on your machine. This communication:
- Never leaves your computer
- Is not encrypted (localhost only)
- Contains only simple commands (join/leave status)

## Data Storage

All data is stored locally using Chrome's built-in storage APIs:

- **`chrome.storage.local`**: Stores meeting state and settings
- Data is encrypted by Chrome and only accessible by this extension
- No data is synced to any external servers

### Data Retention

- Meeting state is cleared when you leave all meetings
- All data is deleted when you uninstall the extension

## Permissions

The extension requests these Chrome permissions:

| Permission | Reason |
|------------|--------|
| `storage` | Store meeting state and extension settings |
| `tabs` | Detect when Google Meet tabs are closed |
| `activeTab` | Access Google Meet page content |
| `notifications` | Show error notifications to user |
| `host_permissions` for meet.google.com | Run content script to detect meetings |
| `host_permissions` for localhost:17394 | Communicate with local Hammerspoon server |

Note: We do NOT request the `identity` permission (no OAuth needed).

## Security

- All communication is local (localhost only)
- No external API calls
- No authentication tokens stored
- Hammerspoon accessibility permissions are controlled by macOS

## Your Rights

You can:
- **View data**: Use Chrome's developer tools to inspect stored data
- **Delete data**: Uninstall the extension to remove all stored data
- **Revoke access**: Disable the extension at any time

## Children's Privacy

This extension is not directed at children under 13 and does not collect data from anyone.

## Changes to This Policy

If we make material changes to this privacy policy, we will update the "Last Updated" date and may notify users through the extension update notes.

## Contact

If you have questions about this privacy policy, please:
- Open an issue on the [GitHub repository](https://github.com/yourusername/google-meet-zoom-status)

## Open Source

This extension is open source. You can review the complete source code at:
[https://github.com/yourusername/google-meet-zoom-status](https://github.com/yourusername/google-meet-zoom-status)
