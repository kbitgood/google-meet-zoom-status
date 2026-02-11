# Google Meet to Zoom Status

Bun monorepo with two packages:

- `packages/extension`: Chrome extension that detects Google Meet join/leave.
- `packages/server`: Bun + Playwright local service that controls Zoom Web (`app.zoom.us`).

The extension calls the local server on `http://127.0.0.1:17394`:

- `GET /health`
- `GET /status`
- `POST /meeting/join`
- `POST /meeting/leave`
- `POST /auth/login` (one-time interactive login + MFA bootstrap)

## Workspace Layout

```text
packages/
  extension/
    src/
    public/
    build.js
    tsconfig.json
    package.json
  server/
    index.ts
    zoom-automator.ts
    tsconfig.json
    package.json
```

## Root Scripts

```bash
bun run build                # extension build
bun run build:watch          # extension watch build
bun run build:dist           # extension release zip
bun run typecheck            # extension + server typecheck
bun run server:dev           # run local zoom automator server
bun run server:compile       # compile server binary to ./bin/zoom-automator
```

## Setup

```bash
bun install
bunx playwright install chromium
```

## One-time auth flow

Start server (foreground):

```bash
bun run server:dev
```

Or run it in the background with `nohup`:

```bash
nohup bun run server:dev > /tmp/zoom-automator-server.log 2>&1 &
echo $! > /tmp/zoom-automator-server.pid
```

Check logs / health when running in background:

```bash
tail -f /tmp/zoom-automator-server.log
curl http://127.0.0.1:17394/health
```

Stop the background server:

```bash
kill "$(cat /tmp/zoom-automator-server.pid)"
```

Then bootstrap login:

```bash
curl -X POST -H "Content-Length: 0" http://127.0.0.1:17394/auth/login
```

Complete Zoom login + MFA in the opened headed browser. Session is persisted for headless automation afterward.

Note: current Bun compile uses `--packages external` for Playwright compatibility, so dependencies still need to be installed in the workspace.

## Extension

Build extension:

```bash
bun run build
```

Install (side-load) in Chrome:

1. Open `chrome://extensions`.
2. Enable `Developer mode` (top-right toggle).
3. Click `Load unpacked`.
4. Select `/Users/kenneth/Projects/google-meet-zoom-status/packages/extension/dist`.
5. Confirm the extension appears in the extensions list.

After code changes, rebuild and click `Reload` on the extension card:

```bash
bun run build
```
