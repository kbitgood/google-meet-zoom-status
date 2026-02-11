# PRD: Google Meet to Zoom Automator Desktop Product

## 1. Introduction / Overview

This project will evolve from a developer-oriented prototype into a user-installable desktop product for macOS.

The final user experience target is:
- Install a desktop app from a DMG.
- Install a Chrome extension from the Chrome Web Store.
- Complete onboarding once.
- After setup, joining/leaving Google Meet automatically starts/ends one private Zoom web meeting in the background to keep Zoom presence accurate.

The existing extension-based Meet detection remains the core trigger source. The backend becomes a desktop menubar app that hosts a local API and automates Zoom Web (`app.zoom.us`) through a hidden browser context.

## 2. Goals

- Deliver a Phase 1 desktop app with:
  - Menu bar app shell
  - Local HTTP API on `127.0.0.1:17394`
  - Hidden Zoom web automation runtime
  - Manual start/stop controls
- Preserve API compatibility with existing extension contract:
  - `GET /health`
  - `GET /status`
  - `POST /meeting/join`
  - `POST /meeting/leave`
  - `POST /auth/login`
- Provide a production-ready onboarding flow across app + extension.
- Publish the Chrome extension in Chrome Web Store.
- Ship distribution guidance for both:
  - Unsigned DMG (primary initial ship)
  - Ad-hoc signing option documentation (without requiring paid Apple Developer account)
- Hit launch success criteria:
  - Onboarding <10 minutes for new users
  - >=95% reliable Meet-to-Zoom automation behavior
  - Low support burden through clear UX and diagnostics

## 3. User Stories

### US-001: Install desktop app from DMG
**Description:** As a user, I want to install the app via DMG so I can run Zoom automation locally without dev tooling.

**Acceptance Criteria:**
- [ ] A DMG build is produced from CI or documented local build flow.
- [ ] App launches on macOS without requiring Bun/Node installation.
- [ ] Unsigned install path is documented with exact Gatekeeper bypass steps.
- [ ] Optional ad-hoc signing path is documented separately.
- [ ] `bun run typecheck` passes.

### US-002: Run menubar app and local API server
**Description:** As a user, I want a menubar app that runs the local API in background so the extension can trigger automation.

**Acceptance Criteria:**
- [ ] Menubar icon appears while app is running.
- [ ] App starts local server bound to `127.0.0.1:17394`.
- [ ] Endpoints `/health`, `/status`, `/meeting/join`, `/meeting/leave`, `/auth/login` respond correctly.
- [ ] Menubar menu includes Start/Stop server and Quit actions.
- [ ] `bun run typecheck` passes.

### US-003: Complete one-time Zoom auth bootstrap
**Description:** As a user, I want to log in once (including MFA) so automation runs later in background.

**Acceptance Criteria:**
- [ ] `/auth/login` opens visible auth flow and supports MFA completion.
- [ ] Persistent session/profile storage is reused for subsequent runs.
- [ ] Auth state is visible in menubar UI and `/status`.
- [ ] Auth failure/expired state provides clear recovery actions.
- [ ] `bun run typecheck` passes.

### US-004: Start/stop one automation meeting from extension triggers
**Description:** As a user, I want Meet join/leave to map to one Zoom automation meeting so my status stays accurate.

**Acceptance Criteria:**
- [ ] First active Meet tab triggers `/meeting/join` once.
- [ ] Additional Meet tabs do not create additional Zoom meetings.
- [ ] Final Meet tab leave triggers `/meeting/leave` and ends meeting for all.
- [ ] If `/meeting/join` is called while already active, operation is idempotent.
- [ ] `bun run typecheck` passes.

### US-005: Extension full pairing and status UX
**Description:** As a user, I want the extension UI to clearly show connection, auth, and automation status so setup and troubleshooting are easy.

**Acceptance Criteria:**
- [ ] Popup includes app connection status, auth state, and meeting automation state.
- [ ] Popup clearly distinguishes: app offline vs auth required vs automation active vs idle.
- [ ] Extension includes guided link/action for installing desktop app and opening local onboarding docs.
- [ ] Error messages are actionable and non-technical.
- [ ] `bun run typecheck` passes.
- [ ] Verify in browser using dev-browser skill.

### US-006: First-run onboarding flow
**Description:** As a user, I want a guided onboarding flow so I can finish setup quickly without reading source docs.

**Acceptance Criteria:**
- [ ] App first-run UI includes steps: install extension, connect extension, log in to Zoom, test automation.
- [ ] Each step has explicit success/failure state.
- [ ] End-to-end setup can be completed in under 10 minutes by a new user.
- [ ] Onboarding includes test action that exercises `/meeting/join` and `/meeting/leave` safely.
- [ ] `bun run typecheck` passes.
- [ ] Verify in browser using dev-browser skill.

### US-007: Reliability and diagnostics
**Description:** As a maintainer, I want reliability instrumentation and user-facing diagnostics so support burden is low.

**Acceptance Criteria:**
- [ ] Structured logs for API calls and automation transitions are available in app UI or log file.
- [ ] Retry/backoff behavior is defined for transient Zoom page failures.
- [ ] A “Copy diagnostics” action exists in app menu or settings.
- [ ] Common failure states have dedicated troubleshooting guidance.
- [ ] `bun run typecheck` passes.

## 4. Functional Requirements

- FR-1: The desktop app must expose the localhost API on `127.0.0.1:17394` with current contract compatibility.
- FR-2: The desktop app must maintain exactly one automation Zoom meeting at any time.
- FR-3: The system must treat join/leave calls idempotently.
- FR-4: The extension must remain the source of truth for Google Meet tab state.
- FR-5: Extension background logic must call `/meeting/join` only on first active Meet tab.
- FR-6: Extension background logic must call `/meeting/leave` only when last active Meet tab exits.
- FR-7: The app must support interactive one-time Zoom authentication with MFA and persistent reuse.
- FR-8: The app must provide visible menubar status for server state, auth state, and automation state.
- FR-9: The extension popup must surface full pairing/auth/runtime status (full UX revamp scope).
- FR-10: The app must provide manual server start/stop controls in menubar UI.
- FR-11: The app must expose user-readable diagnostics and troubleshooting signals.
- FR-12: The project must ship an unsigned DMG path and document ad-hoc signing option.

## 5. Non-Goals (Out of Scope)

- No auto-update framework in v1.
- No telemetry/analytics pipeline in v1.
- No enterprise policy management support in v1.
- No multi-user account orchestration in v1.
- No cloud relay/backend service in v1.
- No Windows or Linux desktop support in v1.
- No Mac App Store distribution target in v1.
- No dependency on paid Apple Developer account in v1.

## 6. Design Considerations

- Menubar UI should prioritize clarity over density:
  - Current state badge
  - Last action/result
  - Quick actions (Start/Stop/Test/Copy diagnostics)
- Extension popup should be task-oriented:
  - “Connected” and healthy state
  - “Auth required” state with next step
  - “App not running” state with clear recovery path
- Onboarding should show deterministic step progression with clear completion checks.

## 7. Technical Considerations

- Recommended production architecture:
  - Electron menubar app with hidden browser runtime for Zoom web automation.
  - Keep existing extension API shape stable to minimize regression risk.
- Local API security (phase-appropriate):
  - Bind localhost only.
  - Add extension/app handshake token and known extension ID checks.
- Selector resilience:
  - Use layered selectors and health checks due Zoom UI drift risk.
- Packaging:
  - Primary: unsigned DMG with explicit install instructions.
  - Secondary: ad-hoc signed packaging docs for reduced warnings where possible.
- Persistence:
  - Keep extension critical state in `chrome.storage.local` due MV3 worker lifecycle.
  - Keep app auth/session state in app data profile path.

## 8. Success Metrics

- SM-1: Median new-user onboarding time <=10 minutes.
- SM-2: >=95% success rate for join/leave event mapping to Zoom automation actions across supported scenarios.
- SM-3: <=1 manual recovery step required in most common failure paths.
- SM-4: Support burden remains low, measured by low frequency of repeated setup troubleshooting themes.

## 9. Open Questions

- OQ-1: Exact packaging tool choice (Electron Forge vs Electron Builder) for v1 pipeline.
- OQ-2: Final persistence location and migration path for auth/session profile data.
- OQ-3: Minimum supported macOS version policy.
- OQ-4: How strict extension-to-app local API authentication should be in v1 vs v1.1.
- OQ-5: Whether launch-at-login should be deferred to Phase 2 or included immediately after Phase 1 stabilization.
