# Implementation specification

This document describes the repository implementation, not every capability in the
upstream protocol. Source and automated tests take precedence over protocol snapshots.
[Protected product requirements](docs/product-requirements.md) define permanent
behavioral guarantees; this inventory describes the current implementation.

## Architecture

```text
Browser: Vue SPA (hash routes)
  | HTTP RPC and local APIs; WebSocket notifications, SSE fallback
Express (production) / Vite middleware (development)
  | AppServerClient -> AppServerWebSocketClient; JSON-RPC initialization
Independently managed Codex app-server (ws/wss or Unix socket)
```

The backend does not install, launch, authenticate, or terminate Codex. The UI and
App Server may run on separate hosts with different homes and CODEX_HOME values.
Project files, Git commands and uploads use App Server RPCs on the remote host.
See [connection and lifecycle details](docs/external-app-server.md).
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

See [client ownership](docs/app-server-client-boundaries.md) and the
[schema inventory](documentation/app-server-schemas/README.md). Protocol presence
and bundled method metadata do not guarantee UI support or live server capability.

## Feature status

| Status | Capabilities |
| --- | --- |
| Implemented | Thread listing/pagination, create/resume/archive, manual naming, forking and rollback; pins, unread state and project grouping |
| Implemented — CAP-001 | Non-destructive Fork and Revert restores a historical prompt as an editable draft in a separate conversation, awaiting explicit submission |
| Implemented — CAP-002 | Portable Fork transfers readable conversation text to a selected provider for continuation, with persisted imported history |
| Implemented — CAP-003 | Historical response timestamps, model and reasoning effort from reliable evidence, independent of current composer settings |
| Implemented | Streaming chat, interrupt, immediate steering during active turns, approval requests, plans, token usage, command output and file-change/diff presentation |
| Implemented | Official Codex model catalog, per-context model/reasoning choices and collaboration modes; effort choices follow model capabilities |
| Implemented | Existing project/worktree folder selection, file attachments/search, installed skills, MCP status/authentication |
| Implemented | External account status/quotas, optional web password, responsive light/dark UI |
| Implemented | On-demand archived conversation browser/restore, account usage reads, bounded warnings and sanitized diagnostic report copying |
| Limited | Web-search mode control is not exposed: scoped effective-setting evidence is not validated; see [conversation tools](docs/conversation-tools.md) |
| Removed | OpenRouter/Zen/custom provider proxies, local Codex process management and automatic authentication |
| Removed | Automation management, deferred prompt queue, built-in tunnels, Open Terminal action, ZIP import/export, external skill catalog/install UI, Telegram integration |
| Implemented | Idle-only native inline code review and manual context compaction, with observed lifecycle outcomes |
| Implemented | Collapsed MCP/Web search execution details, per-turn file-change diffs, native background-process list/exact termination |
| Implemented | Native structured App references, thread goals, plan mode and installed-skill completion |
| Removed | WebUI text presets and recent submitted prompts, Markdown conversation downloads, custom worktree creation, the standalone Git working-tree panel and WebUI slash-command aliases |
| Partial | Native memory readiness/selected summary; base-user MCP enablement scalar editing; vertical-only curated plugin browser; Remote Control status/registered clients |
| Blocked in approved scope | Isolated side chat; additional skill roots/installation/removal without safe native ownership |
| Implemented | Split-host project filesystem, Git, uploads and previews through App Server APIs; no shared filesystem required |

The optional conversation tools, Apps picker and Remote Control view
load through existing async-component boundaries when opened. Reads remain manual;
no new startup RPCs or polling are added. Review/compaction use the existing desktop
notification owner; unknown mutation outcomes are never automatically replayed.
See [approved feature scopes, evidence and verification](docs/approved-features.md).

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
Metadata is bundled advisory information, not live negotiation.
Project file routes and HTTP semantics are documented in
[project file access](docs/project-file-access.md).

GET `/codex-api/meta/notifications` remains a compatibility contract even without
an internal caller; removing it requires an explicit retirement decision.
`/codex-api/thread-file-change-fallback`, `/codex-api/thread-live-state`, and
`/codex-api/thread-stream-events` return JSON 404 (`{"error":"Not found"}`)
for all methods, including query strings, without RPC or SPA fallthrough. There
is no replacement for diagnostic reconstruction or buffered-event retrieval.
Normal history retains snapshots, archive/materialization recovery, pagination,
inline media sanitization and stream-error merging; live WS/SSE is not replay.

`/codex-local-file` and `/codex-local-edit` are retired; use read-only
`/codex-local-browse`, `/codex-local-image`, and `/codex-local-directories`.
The obsolete GET/PUT `/codex-api/preferences/first-launch-plugins-card` contract
is removed; clients must stop calling it. Existing dismissal keys/files are left
untouched. Generic `review/start` RPC remains available without a dedicated UI.

Gateway model catalog reads retain record/page order, deduplicate trimmed IDs,
stop repeated cursors, and return empty results on failure; config reads reject.
Shared reasoning capabilities use owner leases and publication ordering. Resume
coalescing is per thread: pending entries expire after 30 seconds without cancelling
remote work; settled successes and failures reuse a two-second window. Successful
turn start/steer/interrupt and history revert, plus relevant notifications,
invalidate affected entries with identity-safe cleanup. Archive/rename alone do
not invalidate Resume; see the freshness item in open items.
Workspace reads coalesce and return clones; mutations serialize and invalidate
the cache on success or failure. Preserve these distinct error/freshness contracts.

## Routing

Routes use hash history: `/#/` (new chat), `/#/thread/:threadId` (conversation),
and `/#/skills` (installed skills/MCP). `/new-thread` and unknown hash paths redirect
to home. `App.vue` synchronizes selection and routing.

## Development and verification

Use the [development guide](docs/development.md) for the pinned pnpm/Node setup,
build, typecheck, unit tests, isolated fixture, optional HTTPS and live-test boundaries.
The package exposes an ESM CLI, not a public CJS library. Build output is `dist/`
and `dist-cli/`; frontend build includes asset precompression.

Track technical concerns and deferred decisions in [open items](docs/maintenance/open-items.md).

Use the [manual test index](tests.md) for acceptance workflows. Historical tests and
refactoring measurements describe their recorded revisions, not current results.

The legacy `/codex-api/thread-stream-events` buffered-event diagnostic HTTP API is intentionally retired with JSON 404 and no replacement. Internal event buffering and history-error recovery remain; WebSocket/SSE deliver live notifications without historical buffered-event replay.

Read status uses native Codex receipts exclusively; see
[native Codex cleanup](docs/native-codex-cleanup.md) for protocol and data-preservation details.

Native API ownership, removed features, migration and retained adapters are documented in
[capability consolidation](docs/native-project-migration.md).
