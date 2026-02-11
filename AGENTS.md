# AGENTS.md - Google Meet to Zoom Status

## Project Overview

This repository is a Bun monorepo with:

- `packages/extension`: Manifest V3 Chrome extension
- `packages/server`: local Bun server that runs Playwright to automate Zoom Web

The extension must be preserved as the source of Google Meet detection. The server is the automation backend.

## Architecture

```text
packages/
  extension/
    src/background/index.ts
    src/background/zoom-automator-api.ts
    src/background/meeting-state.ts
    src/content/meet-detector.ts
    src/popup/index.ts
    public/manifest.json
  server/
    index.ts
    zoom-automator.ts
```

## API Contract (localhost:17394)

- `GET /health`
- `GET /status`
- `POST /meeting/join`
- `POST /meeting/leave`
- `POST /auth/login`

## Core Behavior

- Track active Google Meet tabs in extension storage.
- On first active Meet tab, call `/meeting/join`.
- Maintain one automation Zoom meeting only.
- On final Meet tab exit, call `/meeting/leave` and end meeting for all.
- Authentication is a one-time headed login via `/auth/login`; persistent browser profile handles subsequent headless runs.

## Commands

```bash
bun run build
bun run build:watch
bun run build:dist
bun run typecheck
bun run server:dev
bun run server:compile
```

## Notes

- Keep extension-server API compatibility stable.
- Keep all critical extension state in `chrome.storage.local` (MV3 service worker lifecycle).
- Zoom web selectors can drift; prefer resilient selector strategies in server automation.
