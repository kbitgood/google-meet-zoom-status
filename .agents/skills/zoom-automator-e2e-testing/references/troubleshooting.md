# Troubleshooting

## 1) Empty reply from server on long POST

### Signature

- `curl: (52) Empty reply from server`
- Server log shows timeout message around request duration limit.

### Fix

- Increase Bun idle timeout (max 255 seconds in current Bun).
- Clamp configured timeout to valid range.
- Keep structured error responses enabled.

## 2) Server starts then appears unreachable from separate commands

### Signature

- Server logs show `listening`, but later commands cannot connect.

### Fix

- Run server and all test commands in the same interactive shell session.
- Use background server with `tee` in that same shell.

## 3) `/meeting/join` hangs indefinitely

### Signature

- Logs stop at `joinMeeting wait for meeting started`.
- Request never returns until user interrupts.

### Fix

- Wrap meeting-start wait in a hard outer timeout.
- Ensure timeout triggers structured 500 response.
- On failure, force context cleanup.

## 4) `/meeting/leave` hangs after failed join

### Signature

- Logs show `leaveMeeting start` then `closeContext begin` and no completion.

### Fix

- Add timeout-safe `closeContext` with fallback browser close.
- Null context references before awaiting close to avoid lockups.
- Always run cleanup on join failures.

## 5) Local `/status` disagrees with real Zoom state

### Signature

- Local endpoint says `Available` or `Starting` while Zoom UI differs.

### Fix

- Use Zoom API `GET /v2/users/me/presence_status` as source of truth.
- Treat local status as internal state only.

## 6) Auth looks complete but join returns 401 auth required

### Signature

- `/auth/login` returned, but `/meeting/join` returns auth required.

### Fix

- Re-check `/health` for `authenticated:true`.
- Repeat `/auth/login` and confirm success response in same shell session.
- Confirm persistent profile path is stable and writable.

## 7) Zoom API 429 rate limit during presence checks

### Signature

- `{"code":429,"message":"You have reached the maximum per-second rate limit"}`

### Fix

- Add backoff between presence checks.
- Avoid polling in tight loops.
