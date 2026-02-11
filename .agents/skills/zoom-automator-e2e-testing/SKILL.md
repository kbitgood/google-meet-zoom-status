---
name: zoom-automator-e2e-testing
description: Run deterministic end-to-end verification of the Zoom Automator local server and Chrome extension integration, with step-by-step command execution, tee-based server log capture, and direct Zoom presence API checks. Use when debugging join/leave behavior, auth persistence, server timeouts, or mismatches between local /status and real Zoom status.
---

# Zoom Automator E2E Testing

## Overview

Use this skill to verify the full local flow in small, observable steps:
1. start server with persistent logs,
2. authenticate,
3. run `/meeting/join` and `/meeting/leave`,
4. validate against Zoom API presence directly.

Run commands one at a time and inspect output before continuing.

## Workflow

### 1. Start in one interactive shell

Keep server and test commands in the same shell when environment isolation is suspected.

```bash
cd /Users/kenneth/Projects/google-meet-zoom-status
zsh
```

### 2. Start server with tee logging

```bash
pkill -f "bun run server:dev" || true
pkill -f "bun run index.ts" || true
rm -f /tmp/zoom-automator-server.log
bun run server:dev 2>&1 | tee /tmp/zoom-automator-server.log &
sleep 1
curl -sS http://127.0.0.1:17394/health
```

Require successful `/health` before moving on.

### 3. Complete server auth bootstrap

```bash
curl -sS -D - -X POST -H "Content-Length: 0" http://127.0.0.1:17394/auth/login
curl -sS http://127.0.0.1:17394/health
```

Expect `authenticated:true` in health output.

### 4. Query baseline Zoom status (source of truth)

Use OAuth token file from capture flow:

```bash
ACCESS_TOKEN=$(sed -n 's/.*"access_token": "\([^"]*\)".*/\1/p' /tmp/zoom-oauth-token.json | head -n1)
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" https://api.zoom.us/v2/users/me/presence_status
```

Treat Zoom API status as authoritative over local `/status`.

### 5. Run join/leave/join checks

Run each command separately and inspect server logs after each.

```bash
curl -sS -D - -X POST -H "Content-Length: 0" http://127.0.0.1:17394/meeting/join
curl -sS http://127.0.0.1:17394/health
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" https://api.zoom.us/v2/users/me/presence_status

curl -sS -D - -X POST -H "Content-Length: 0" http://127.0.0.1:17394/meeting/leave
curl -sS http://127.0.0.1:17394/health
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" https://api.zoom.us/v2/users/me/presence_status

curl -sS -D - -X POST -H "Content-Length: 0" http://127.0.0.1:17394/meeting/join
curl -sS http://127.0.0.1:17394/health
curl -sS -D - -H "Authorization: Bearer $ACCESS_TOKEN" https://api.zoom.us/v2/users/me/presence_status
```

### 6. Inspect logs continuously

```bash
tail -n 120 /tmp/zoom-automator-server.log
```

Use request IDs to correlate server responses with action logs.

## Required Observability Rules

- Return structured JSON from all API endpoints, including errors.
- Include `requestId` in success and error responses.
- Log `request start` and `request end` with duration.
- Log automator stage transitions (`auth`, `join`, `leave`, `closeContext`).
- Never rely on local `/status` alone for product correctness.

## Expected Outcomes

- `/auth/login` returns `200` and health shows `authenticated:true`.
- `/meeting/join` returns either:
  - `200` with success message, or
  - structured `500` with actionable error details.
- `/meeting/leave` returns quickly and never hangs indefinitely.
- Zoom presence API reflects true status transitions.

## Troubleshooting

Read [references/troubleshooting.md](references/troubleshooting.md) for failure signatures and fixes discovered during live testing.
