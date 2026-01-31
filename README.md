# Google Meet to Zoom Status

A Chrome extension that automatically updates your Zoom presence status when you join or leave Google Meet calls. Uses Hammerspoon (macOS) for local Zoom control - no cloud services or OAuth required.

## Features

- **Automatic Status Sync**: Detects when you join a Google Meet and sets your Zoom status to "Busy" with a custom message "In Google Meet"
- **Smart Restore**: Automatically restores your Zoom status to "Available" when you leave the meeting
- **Multi-Tab Support**: Handles multiple Google Meet tabs - status only resets when you leave all meetings
- **100% Local**: All processing happens on your Mac - no cloud services, no OAuth, no API rate limits
- **Custom Status Message**: Sets "In Google Meet" as your Zoom status message (not possible with Zoom's REST API)

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Chrome         │     │   Hammerspoon    │     │     Zoom        │
│  Extension      │────▶│   HTTP Server    │────▶│   (macOS app)   │
│                 │     │   localhost:17394│     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
     Detects              Receives HTTP           UI automation via
     Google Meet          requests and            accessibility APIs
     join/leave           controls Zoom
```

The extension detects Google Meet events and sends HTTP requests to a local Hammerspoon server, which then controls Zoom's native macOS app via accessibility APIs.

## Requirements

- **macOS** (Hammerspoon is macOS-only)
- **Chrome** or Chromium-based browser (Arc, Edge, Brave, etc.)
- **Hammerspoon** - free macOS automation tool
- **Zoom** desktop app installed

## Installation

### 1. Install Hammerspoon

```bash
brew install --cask hammerspoon
```

Or download from [hammerspoon.org](https://www.hammerspoon.org/).

**Important**: Grant Hammerspoon accessibility permissions when prompted (System Settings > Privacy & Security > Accessibility).

### 2. Set Up the Hammerspoon Module

Add the zoom_status module to your Hammerspoon config:

```bash
# Add the module path to your init.lua
echo 'package.path = package.path .. ";/path/to/google-meet-zoom-status/scripts/?.lua"' >> ~/.hammerspoon/init.lua
echo 'require("zoom_status")' >> ~/.hammerspoon/init.lua
```

Or manually edit `~/.hammerspoon/init.lua`:

```lua
-- Add path to the zoom_status module
package.path = package.path .. ";/Users/YOUR_USERNAME/Projects/google-meet-zoom-status/scripts/?.lua"

-- Load the module (starts HTTP server automatically)
require("zoom_status")
```

Reload Hammerspoon (click menubar icon > Reload Config).

### 3. Install the Chrome Extension

**From Source:**

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/google-meet-zoom-status.git
   cd google-meet-zoom-status
   ```

2. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. Load in Chrome:
   - Open `chrome://extensions`
   - Enable "Developer mode" (toggle in top-right)
   - Click "Load unpacked"
   - Select the `dist/` folder

### 4. Verify Setup

1. Check Hammerspoon server is running:
   ```bash
   curl http://localhost:17394/health
   # Should return: {"success":true,"service":"zoom-status","version":"1.0"}
   ```

2. Click the extension icon - should show "Hammerspoon: Connected"

3. Make sure Zoom is running

## Usage

Once installed, the extension works automatically:

1. **Join a Google Meet** → Zoom status changes to "Busy" with message "In Google Meet"
2. **Leave the meeting** → Zoom status returns to "Available"

### Extension Popup

Click the extension icon to see:
- **Hammerspoon**: Connection status to local server
- **Meeting Status**: Whether you're currently in a Google Meet
- **Zoom Status**: Your current Zoom presence status

### Manual Testing

Test the Hammerspoon integration directly:

```bash
# Check current status
curl http://localhost:17394/status

# Simulate joining a meeting
curl -X POST -H "Content-Length: 0" http://localhost:17394/meeting/join

# Simulate leaving a meeting  
curl -X POST -H "Content-Length: 0" http://localhost:17394/meeting/leave
```

## Development

### Prerequisites

- Node.js 18.0.0 or later
- npm

### Commands

```bash
# Install dependencies
npm install

# Build extension
npm run build

# Build with watch mode
npm run build:watch

# Type checking
npm run typecheck
```

### Project Structure

```
src/
├── background/              # Service worker
│   ├── index.ts            # Main entry point
│   ├── hammerspoon-api.ts  # HTTP client for Hammerspoon
│   └── meeting-state.ts    # Meeting state tracking
├── content/                 # Content scripts (Google Meet)
│   ├── index.ts            # Entry point
│   └── meet-detector.ts    # Meeting detection logic
├── popup/                   # Extension popup
│   └── index.ts            # Popup logic
├── utils/                   # Shared utilities
│   ├── storage.ts          # Chrome storage helpers
│   ├── notifications.ts    # Notification system
│   └── logger.ts           # Logging utility
└── types.ts                 # TypeScript types

scripts/
└── zoom_status.lua          # Hammerspoon module

public/
├── manifest.json            # Extension manifest
├── popup.html               # Popup HTML
├── popup.css                # Popup styles
└── icons/                   # Extension icons
```

## Troubleshooting

### "Hammerspoon: Not running" in popup

1. Make sure Hammerspoon is running (check menubar)
2. Verify the zoom_status module is loaded:
   ```bash
   curl http://localhost:17394/health
   ```
3. If no response, check `~/.hammerspoon/init.lua` has the correct path
4. Reload Hammerspoon config

### Zoom status not changing

1. Make sure Zoom app is running and signed in
2. The Zoom window needs to exist (can be minimized, but not closed)
3. Check Hammerspoon console for errors (Hammerspoon menubar > Console)
4. Verify accessibility permissions for Hammerspoon

### Meeting detection not working

1. Open Chrome DevTools on the Google Meet tab
2. Look for `[MeetDetector]` messages in console
3. Make sure you've actually joined (not just on preview screen)

### Extension not connecting to Hammerspoon

Check that `http://localhost:17394` is accessible:
```bash
curl -v http://localhost:17394/health
```

If blocked, check for firewall rules or other software blocking localhost.

## Privacy

This extension:
- Runs entirely on your local machine
- No cloud services, no external API calls
- No data collection or transmission
- Only accesses Google Meet pages to detect meeting state
- Only communicates with localhost (Hammerspoon)

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for the full privacy policy.

## Why Hammerspoon?

The Zoom REST API doesn't support setting custom status messages - only presence status (Available, Away, DND). To show "In Google Meet" as your status message, we need to control Zoom's native UI, which Hammerspoon can do via macOS accessibility APIs.

Benefits:
- Custom status messages ("In Google Meet")
- No OAuth setup required
- No API rate limits
- No cloud dependencies
- Works offline (once Zoom is signed in)

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

- [Hammerspoon](https://www.hammerspoon.org/) for macOS automation
- [Chrome Extensions API](https://developer.chrome.com/docs/extensions/) for the extension framework
- [esbuild](https://esbuild.github.io/) for blazing fast builds
