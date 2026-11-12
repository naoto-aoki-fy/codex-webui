# Implementation specification

This document describes the repository implementation, not every capability in the
upstream protocol. Source and automated tests take precedence over protocol snapshots.

## Architecture

```text
Browser: Vue SPA (hash routes)
  | HTTP RPC and local APIs; WebSocket notifications, SSE fallback
Express (production) / Vite middleware (development)
  | AppServerClient -> AppServerWebSocketClient; JSON-RPC initialization
Independently managed Codex app-server (ws/wss or Unix socket)
```

The backend does not install, launch, authenticate, or terminate Codex. Use the same
user, CODEX_HOME and filesystem paths for both processes. A remote endpoint alone
is not split-host support. See [connection and lifecycle details](docs/external-app-server.md).
Web password authentication protects the browser backend separately from Codex authentication.

## Responsibility boundaries

- `src/App.vue`: application composition, route synchronization, dialogs and settings.
- `src/composables/useDesktopState.ts`: shared reactive state, optimistic messages,
  history coordination, preferences and notification reconciliation; no Pinia/Vuex.
- `src/api/codexGateway.ts`: typed UI operations and normalization;
  `codexRpcClient.ts`: browser HTTP and notification transport.
- `src/server/codexAppServerBridge.ts`: local HTTP dispatch and shared connection state;
  account and skills routes delegate to dedicated modules.
- `AppServerClient` in the bridge: RPC correlation, snapshots and history recovery;
  `appServerWebSocketClient.ts`: external transport and reconnect.
- `src/server/httpServer.ts` and `src/cli/index.ts`: production hosting and CLI.
- `documentation/`: retained upstream protocol reference and generated schemas.

See [frontend boundaries](docs/refactoring/frontend-boundaries.md),
[backend boundaries](docs/refactoring/backend-boundaries.md) and the
[schema inventory](documentation/app-server-schemas/README.md). Protocol presence
and bundled method metadata do not guarantee UI support or live server capability.

## Feature status

| Status | Capabilities |
| --- | --- |
| Implemented | Thread listing/pagination, create/resume/archive, manual naming, forking and rollback; pins, unread state and project grouping |
| Implemented | Streaming chat, interrupt, immediate steering during active turns, approval requests, plans, token usage, command output and file-change/diff presentation |
| Implemented | Official Codex model catalog, per-context model/reasoning choices and collaboration modes; effort choices follow model capabilities |
| Implemented | Existing project/worktree folder selection, file attachments/search, installed skills, MCP status/authentication |
| Implemented | External account status/quotas, optional web password, responsive light/dark UI |
| Removed | OpenRouter/Zen/custom provider proxies, local Codex process management and automatic authentication |
| Removed | Automation management, deferred prompt queue, built-in tunnels, Open Terminal action, ZIP import/export, external skill catalog/install UI, Telegram integration |
| Not surfaced | Dedicated code-review workflow (`review/start`); generic RPC and protocol definitions remain |
| Unsupported deployment | Split-host filesystem operation based solely on an external app-server URL |

The Skills route manages already installed skills; installation is external.
See [installed skills](docs/installed-skills.md). Removed UI does not imply removal
of compatibility data, generic RPC methods or generated protocol schemas.

## History, events and persistence

Thread lists load in pages (initial limit 50, background limit 100). Detail loading
uses `thread/read` with `includeTurns: true`; the bridge bounds RPC history to the
latest 10 turns. Older turns load through `/codex-api/thread-turn-page`. The legacy
`/codex-api/thread-live-state` diagnostic/recovery endpoint is retired and returns
JSON 404. Its full-history command/file-change reconstruction is intentionally
removed without replacement; normal history and shared recovery remain.

Notifications arrive on `/codex-api/ws`, falling back to `/codex-api/events`.
Realtime updates apply immediately; event-driven reconciliation is debounced
(220 ms). This is coordinated with history caches and active-thread loading, not
an unconditional full-history fetch on every event. External disconnects fail
pending RPC calls; requests are not replayed automatically.

Browser storage retains read state, model/reasoning/collaboration preferences and
layout state, including legacy migration keys. Opening home does not restore the
last selected thread. Thread names and pins use native Codex state. Workspace UI preferences use shared global
state; attachment-only history has an [app-owned index](docs/persistent-thread-index.md).
Persistence does not make sending messages available while disconnected.

## Bridge contracts

### HTTP Endpoints (Bridge)

| Method | Path | Purpose |
|---|---|---|
| POST | `/codex-api/rpc` | JSON-RPC proxy — forwards `{ method, params }` to app-server |
| POST | `/codex-api/server-requests/respond` | Reply to server-initiated requests |
| GET | `/codex-api/server-requests/pending` | List pending server requests |
| GET | `/codex-api/meta/methods` | Discover available RPC methods |
| GET | `/codex-api/meta/notifications` | Discover available notification types |
| GET | `/codex-api/events` | SSE fallback stream for real-time notifications |
| WS upgrade | `/codex-api/ws` | Primary WebSocket channel for real-time notifications |

These are the core transport endpoints, not an exhaustive local API inventory.
The notification catalog endpoint is retained for compatibility, even without an
internal caller. Metadata is bundled advisory information, not live negotiation.
Local file routes are documented in [API compatibility notes](docs/api-wrapper-cleanup.md).

## Routing

Routes use hash history: `/#/` (new chat), `/#/thread/:threadId` (conversation),
and `/#/skills` (installed skills/MCP). `/new-thread` and unknown hash paths redirect
to home. `App.vue` synchronizes selection and routing.

## Development and verification

Use the [development guide](docs/development.md) for the pinned pnpm/Node setup,
build, typecheck, unit tests, isolated fixture, optional HTTPS and live-test boundaries.
The package exposes an ESM CLI, not a public CJS library. Build output is `dist/`
and `dist-cli/`; frontend build includes asset precompression.

Use the [manual test index](tests.md) for acceptance workflows. Historical tests and
refactoring measurements describe their recorded revisions, not current results.

The legacy `/codex-api/thread-stream-events` buffered-event diagnostic HTTP API is intentionally retired with JSON 404 and no replacement. Internal event buffering and history-error recovery remain; WebSocket/SSE deliver live notifications without historical buffered-event replay.

Read status uses native Codex receipts exclusively; see
[native Codex cleanup](docs/native-codex-cleanup.md) for protocol and data-preservation details.

Native API ownership, removed features, migration and retained adapters are documented in
[capability consolidation](docs/refactoring/native-capability-consolidation.md).
