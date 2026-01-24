# Google Meet to Zoom Status

A Chrome extension that automatically updates your Zoom presence status when you join or leave Google Meet calls.

## Features

- **Automatic Status Sync**: Detects when you join a Google Meet and sets your Zoom status to "Do Not Disturb"
- **Smart Restore**: Automatically restores your previous Zoom status when you leave the meeting
- **Multi-Tab Support**: Handles multiple Google Meet tabs - status only resets when you leave all meetings
- **Visual Indicators**: Extension badge shows current state (connected, disconnected, in meeting)
- **Error Recovery**: Graceful handling of network issues, token expiry, and API errors

## Installation

### From Chrome Web Store (Recommended)

1. Visit the [Chrome Web Store listing](#) *(link coming soon)*
2. Click "Add to Chrome"
3. Follow the setup instructions below

### From Source (Developer Installation)

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/google-meet-zoom-status.git
   cd google-meet-zoom-status
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `dist/` folder

## Zoom OAuth App Setup

Before using the extension, you need to create a Zoom OAuth app to authorize status updates.

### Quick Setup

1. Go to [Zoom App Marketplace](https://marketplace.zoom.us/develop/create)
2. Sign in and click **Build App** > **OAuth**
3. Configure your app:
   - **App Name**: `Google Meet Status Sync`
   - **Redirect URL**: `https://<YOUR_EXTENSION_ID>.chromiumapp.org/`
     - Get your extension ID from `chrome://extensions` after loading the extension
   - **Scopes**: Add `user:read` and `user:write`
4. Copy your **Client ID** and **Client Secret**
5. Create `src/config.ts` from the example:
   ```bash
   cp src/config.example.ts src/config.ts
   ```
6. Add your credentials to `src/config.ts`
7. Rebuild: `npm run build`

For detailed instructions, see [docs/ZOOM_OAUTH_SETUP.md](docs/ZOOM_OAUTH_SETUP.md).

## Usage

1. Click the extension icon in your browser toolbar
2. Click "Connect Zoom" to authorize the extension
3. Authorize with your Zoom account in the popup
4. You're set! The extension will now automatically:
   - Set your Zoom status to "Do Not Disturb" when you join a Google Meet
   - Restore your previous status when you leave

### Status Indicators

| Badge | Meaning |
|-------|---------|
| Gray | Not connected to Zoom |
| Green | Connected and ready |
| Red with "MTG" | Currently in a meeting |

## Development

### Prerequisites

- Node.js 18.0.0 or later
- npm or pnpm

### Commands

```bash
# Install dependencies
npm install

# Build extension (development)
npm run build

# Build with watch mode
npm run build:watch

# Build for production (minified + ZIP)
npm run build:dist

# Type checking
npm run typecheck
```

### Project Structure

```
src/
├── background/           # Service worker
│   ├── index.ts         # Main entry point
│   ├── zoom-auth.ts     # OAuth authentication
│   ├── zoom-api.ts      # Zoom API calls
│   └── meeting-state.ts # Meeting state tracking
├── content/             # Content scripts (Google Meet)
│   ├── index.ts         # Entry point
│   └── meet-detector.ts # Meeting detection logic
├── popup/               # Extension popup
│   └── index.ts         # Popup logic
├── utils/               # Shared utilities
│   ├── storage.ts       # Chrome storage helpers
│   ├── notifications.ts # Notification system
│   └── logger.ts        # Logging utility
├── types.ts             # TypeScript types
└── config.ts            # Zoom credentials (not in git)

public/
├── manifest.json        # Extension manifest
├── popup.html           # Popup HTML
├── popup.css            # Popup styles
└── icons/               # Extension icons
```

## Troubleshooting

### "Invalid redirect URI" Error

- Ensure the redirect URI in Zoom matches exactly: `https://<EXTENSION_ID>.chromiumapp.org/`
- The URL must end with a trailing slash
- Extension ID must be lowercase

### Extension ID Changed

If you reload the unpacked extension, the ID may change:
1. Get the new ID from `chrome://extensions`
2. Update the redirect URI in your Zoom app settings
3. Update `src/config.ts` with the new redirect URI

### Status Not Updating

1. Check the extension popup for error messages
2. Ensure you have a valid Zoom connection (green badge)
3. Try disconnecting and reconnecting to Zoom
4. Check the console for errors (right-click extension icon > Inspect popup)

### OAuth Popup Not Opening

- Ensure popups aren't blocked for Chrome extensions
- Try disabling other extensions that might interfere
- Check Chrome's console for JavaScript errors

### Rate Limit Errors

Zoom limits presence status updates to approximately 100/day. The extension is designed to minimize API calls, but if you're testing frequently:
- Wait a few hours before testing again
- The extension will automatically retry with backoff

## Privacy

This extension:
- Only accesses Google Meet pages to detect meeting state
- Only communicates with Zoom's API to update your status
- Stores OAuth tokens locally in Chrome's secure storage
- Never collects, transmits, or stores any personal data beyond what's required for functionality

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for the full privacy policy.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Acknowledgments

- [Zoom API](https://developers.zoom.us/) for the presence status API
- [Chrome Extensions API](https://developer.chrome.com/docs/extensions/) for the extension framework
- [esbuild](https://esbuild.github.io/) for blazing fast builds
