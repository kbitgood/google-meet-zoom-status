# Testing Guide

## Prerequisites

1. Bun dependencies installed: `bun install`
2. Playwright browser installed: `bunx playwright install chromium`
3. Zoom Automator server running: `bun run server:dev`
4. Extension built: `bun run build`
5. Extension loaded from `packages/extension/dist/`

## Verify server

```bash
curl http://127.0.0.1:17394/health
curl http://127.0.0.1:17394/status
```

## One-time login bootstrap

```bash
curl -X POST -H "Content-Length: 0" http://127.0.0.1:17394/auth/login
```

Complete Zoom login + MFA in the opened browser window.

## Integration tests

### Join/Leave endpoints

```bash
curl -X POST -H "Content-Length: 0" http://127.0.0.1:17394/meeting/join
curl -X POST -H "Content-Length: 0" http://127.0.0.1:17394/meeting/leave
```

Expected:
- Join starts one private Zoom web meeting.
- Leave ends meeting for all.

### Extension meeting detection

1. Join a Google Meet.
2. Confirm popup shows:
   - `Zoom Automator: Connected`
   - `Meeting Status: In a meeting`
   - `Zoom Status: In Meeting` (or equivalent)
3. Leave Meet.
4. Confirm automation meeting ends and popup status clears.

### Multi-tab behavior

1. Join Meet in tab A.
2. Join Meet in tab B.
3. Leave tab A: Zoom automation meeting should remain active.
4. Leave tab B: Zoom automation meeting should end.

## Debugging

- Service worker logs: `chrome://extensions` -> extension -> service worker console.
- Meet detector logs: open DevTools on `meet.google.com` tab and watch `[MeetDetector]` logs.
- Server logs: terminal running `bun run server:dev`.
