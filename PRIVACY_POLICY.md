# Privacy Policy

**Google Meet to Zoom Status**  
*Last Updated: January 24, 2026*

## Overview

Google Meet to Zoom Status is a Chrome browser extension that automatically updates your Zoom presence status when you join or leave Google Meet video calls. This privacy policy explains what data the extension accesses, how it's used, and how it's protected.

## Data Collection

### What We Collect

This extension collects and processes the following data **locally on your device**:

| Data Type | Purpose | Storage |
|-----------|---------|---------|
| Zoom OAuth tokens | Authenticate with Zoom API | Chrome local storage |
| Zoom user ID | Make API calls to update your status | Chrome local storage |
| Meeting state | Track if you're in a Google Meet call | Chrome local storage |
| Previous Zoom status | Restore your status after meetings | Chrome local storage |

### What We Do NOT Collect

- We do NOT collect personal information (name, email, etc.)
- We do NOT collect meeting content, audio, video, or chat
- We do NOT collect browsing history
- We do NOT track which meetings you attend
- We do NOT collect Google account information
- We do NOT transmit any data to our servers (we don't have servers)

## Data Usage

All data processing happens locally on your device. The extension:

1. **Detects meeting state**: Monitors the Google Meet page DOM to detect when you join or leave a meeting
2. **Updates Zoom status**: Makes API calls directly to Zoom's servers to update your presence status
3. **Stores authentication**: Saves OAuth tokens in Chrome's local storage to avoid repeated logins

## Third-Party Services

### Zoom

When you connect your Zoom account, the extension communicates directly with Zoom's API servers (`api.zoom.us`) to:
- Authenticate your account via OAuth
- Read your current presence status
- Update your presence status

This communication is governed by [Zoom's Privacy Policy](https://zoom.us/privacy).

### Google Meet

The extension runs a content script on Google Meet pages (`meet.google.com`) to detect meeting join/leave events. It does NOT:
- Access your Google account
- Read meeting content
- Record any meeting data

## Data Storage

All data is stored locally using Chrome's built-in storage APIs:

- **`chrome.storage.local`**: Stores OAuth tokens, user ID, and meeting state
- Data is encrypted by Chrome and only accessible by this extension
- No data is synced to any external servers

### Data Retention

- OAuth tokens are stored until you disconnect from Zoom or uninstall the extension
- Meeting state is cleared when you leave all meetings
- All data is deleted when you uninstall the extension

## Permissions

The extension requests these Chrome permissions:

| Permission | Reason |
|------------|--------|
| `identity` | Required for OAuth authentication with Zoom |
| `storage` | Store authentication tokens and extension state |
| `tabs` | Detect when Google Meet tabs are closed |
| `activeTab` | Access Google Meet page content |
| `notifications` | Show error notifications to user |
| `host_permissions` for meet.google.com | Run content script to detect meetings |
| `host_permissions` for api.zoom.us | Communicate with Zoom API |
| `host_permissions` for zoom.us | OAuth token exchange |

## Security

- OAuth tokens are stored in Chrome's secure local storage
- Client secrets are bundled in the extension (required for OAuth flow)
- All API communication uses HTTPS
- No data is transmitted to any third parties beyond Zoom's API

## Your Rights

You can:
- **Disconnect**: Click "Disconnect" in the popup to remove your Zoom authorization
- **View data**: Use Chrome's developer tools to inspect stored data
- **Delete data**: Uninstall the extension to remove all stored data
- **Revoke access**: Revoke the app's access from your [Zoom App Marketplace settings](https://marketplace.zoom.us/user/installed)

## Children's Privacy

This extension is not directed at children under 13 and does not knowingly collect data from children.

## Changes to This Policy

If we make material changes to this privacy policy, we will update the "Last Updated" date and may notify users through the extension update notes.

## Contact

If you have questions about this privacy policy, please:
- Open an issue on the [GitHub repository](https://github.com/yourusername/google-meet-zoom-status)
- Contact us at [your-email@example.com]

## Open Source

This extension is open source. You can review the complete source code at:
[https://github.com/yourusername/google-meet-zoom-status](https://github.com/yourusername/google-meet-zoom-status)
