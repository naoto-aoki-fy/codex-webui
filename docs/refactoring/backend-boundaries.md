> Historical structural audit; removed-feature descriptions are superseded by [current capability ownership](native-capability-consolidation.md).

> Historical audit: Telegram integration has since been removed. References below describe the earlier implementation, not current behavior.

# Backend responsibility boundaries

## Responsibility map

| Responsibility | Gateway (`src/api/codexGateway.ts`) | Bridge (`src/server/codexAppServerBridge.ts`) / dependencies |
| --- | --- | --- |
| RPC transport | `callRpc` normalizes errors; delegates to `codexRpcClient` | `AppServerClient` correlates requests; `AppServerWebSocketClient` owns external WebSocket transport |
| Lifecycle and subscriptions | Notification subscription delegates to RPC client | Shared bridge state, connection generations, initialization, reconnect, subscription restoration, pending replies, SSE |
| Thread management | Start, resume, fork, archive, rename, turns, goals | RPC dispatch, archive recovery, generation metadata, title/pin persistence |
| History and recovery | DTO normalization, summary/detail/turn pages | Snapshots, stream buffers, session-log recovery, file/command reconstruction, persistent index and search |
| Models and account | Model/config/reasoning adapters, reactive catalog, rate limits, auth facade | RPC proxy, token refresh and credential helpers; `accountRoutes` already separates account HTTP handling |
| Project and Git | Workspace state cache and mutation queue, directory/worktree/Git HTTP adapters | Workspace persistence/canonicalization, project creation, clone/worktree commands and rollback |
| Files | Attachment input, upload and composer search adapters | Upload parsing, ripgrep search, file-change apply/revert, inline-payload sanitization; composer prompt file storage now separate |
| Skills | Skill list normalization | `skillsRoutes` already handles skill HTTP operations; bridge still supplies RPC and request-body access |
| Telegram | Configure/status/test HTTP adapters and config normalization | Config mutation queue and lifecycle wiring; `TelegramNotificationService` owns notification delivery |
| HTTP dispatch | Fetch adapters for local endpoints | `createCodexBridgeMiddleware` matches routes, parses bodies, maps errors, streams events, records request timing |

## Selected extraction: composer prompt file storage

`composerPromptFiles.ts` owns listing, creation, name/description normalization,
collision suffixes and deletion checks. The bridge passes the current
`CODEX_HOME/prompts` directory on every call. The module imports only Node filesystem
and path APIs; it does not import the bridge, transport, credentials or global state.
Previously these helpers directly captured bridge-local home-directory resolution.
The gateway and its exports are unchanged.

Route ordering, request validation, HTTP status/error envelopes and authentication
placement remain in the bridge. Filesystem algorithms and error propagation are
moved unchanged. Existing deletion restrictions are preserved; this extraction does
not redesign path policy or concurrent filename allocation.

No connection ownership, RPC correlation, subscription ordering, reconnect logic,
thread recovery, shared cache or persistence queue moves in this step.

## Validation and performance audit

Focused temporary-directory tests cover missing directories, filtering and ordering,
name sanitization, collision suffixes, content/description normalization, deletion
restrictions, repeat deletion and filesystem error propagation. Run the full unit
suite, typecheck, build and credential-free external app-server fixture as regression
checks. The fixture does not establish live authentication or reconnect behavior.

Code-path audit: each prompt request invokes the same filesystem algorithm once.
There are no added RPC/HTTP calls, caches, background work, startup I/O or payload
copies. Listing retains its existing per-file `Promise.all` fanout; creation retains
its existing synchronous collision probes. No new fanout or invalidation mechanism
is introduced. Live latency and browser startup were not measured for this storage-only
move. The CLI build and public entry smoke check validate the added module boundary.

## Recommended next steps

1. Prompt HTTP dispatch is now extracted into `promptRoutes.ts`, with route-level
   tests in `promptRoutes.test.ts`; preserve this boundary in future changes.
2. Separate gateway model/account normalization and operations behind existing exports;
   keep reactive catalog identity and RPC error normalization intact.
3. Extract project/Git commands from HTTP dispatch with explicit workspace persistence
   callbacks; test rollback and canonicalization before moving mutation queues.
4. Separate Telegram config storage from lifecycle wiring, preserving serialized writes
   and service stop/configure/start ordering.
5. Extract history parsing as pure functions before moving recovery orchestration;
   retain cache ownership and session/snapshot merge ordering in the client initially.
6. Split client RPC correlation from lifecycle and subscriptions only after adding
   generation/reconnect/event-order tests. Keep the external server externally owned.

Each step should be independently reviewable and retain the gateway and HTTP contracts.

Validation results for this extraction:

- Full unit suite: 335 passed, 1 failed. The desktop-state optimistic completion test
  duplicates `user:hi`; running that test file with the original HEAD bridge also
  fails with the same assertion. This unrelated failure is left unchanged.
- Focused prompt/bridge/gateway regression suite: 51 tests passed across five files.
- Typecheck and full frontend/CLI build: passed.
- External app-server fixture: built CLI and dev entry passed HTTP RPC, metadata and
  browser WebSocket checks, with one upstream connection per launch; fixture server
  survived both shutdowns.
- Public CLI smoke: `node -e "process.argv = ['node', 'dist-cli/index.js', '--help']; import('./dist-cli/index.js')"`
  exited 0 and printed CLI options/commands. The package exposes an ESM executable,
  not a CJS export; this uses dynamic import from a CJS caller.
