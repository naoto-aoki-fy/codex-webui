# Native capability consolidation

## Evidence and compatibility

The application connects to an independently managed app-server, not a bundled
Codex runtime. No `codex` executable is available in the investigation environment;
a running deployment's version and live feature availability remain unverified.
The checked-in generated schemas are older than current upstream and do not
establish a minimum version for new methods.

Protocol evidence: OpenAI Codex source snapshot
`c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee`, especially
`codex-rs/app-server-protocol/src/protocol/common.rs` and
`protocol/v2/thread.rs`, plus current upstream common.rs:
https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/common.rs

The client already initializes with `capabilities.experimentalApi: true`.
This opts in; it does not guarantee method availability on an older server.

## Feature matrix

| Feature | Original implementation | Supported mechanism | Status and limitation |
| --- | --- | --- | --- |
| Saved prompts | `composerPromptFiles.ts`, `promptRoutes.ts`, composer dropdown; `$CODEX_HOME/prompts/*.md` | Existing `skills/list` and skill inputs in `turn/start`; no prompt/preset CRUD method in inspected protocol | Partially migrated: Skills already supported; prompt compatibility retained. Automatic conversion would change argument and invocation semantics. No files deleted or rewritten. |
| Pinning | `threadPresentationStore.ts`, `/codex-api/thread-pins`, global-state `pinned-thread-ids`, sidebar ordering | `threadSection/list`, create/update/delete and `thread/section/move` exist | Blocked — verification required: sections are server-owned grouping, not a verified pin flag. Mapping pins into a section could displace existing section associations. Existing pins preserved. |
| Read/unread | `desktopStatePersistence.ts` browser timestamps and event flags | Experimental `thread/list.readStates`, `thread/readState/update`, `thread/readState/changed` | Partially migrated: server receipts take precedence when supplied; older/ineligible rows retain browser fallback. |
| Full-text search | Earlier scanning/cache implementation already removed before this task | Experimental `thread/search`, paginated `searchTerm`, `archived`, `sortKey`, `limit`, `cursor` | Migrated in existing code: native results normalized and navigable; unsupported API errors propagate; no history scan fallback. Live runtime verification outstanding. |
| Worktrees | `gitWorkspaceRoutes.ts` Git worktree creation, workspace root persistence; runtime composer selection | Native `thread/start`/resume cwd supports existing directories; no worktree lifecycle method in inspected protocol | Retained — native API unavailable: retain Git creation/rollback. No repositories or worktrees modified by this task. |

## Read receipts and migration

A native receipt contains `firstUnread` (null means read) and an opaque `revision`.
Updates send `{threadId, operation: {type: "read"}, expectedRevision}`.
Conflicts are not retried with unseen revisions. A failed update displays an error
and does not fall back to writing a browser timestamp for that native row.
Notifications update visible rows. The persistent thread pager carries native
receipts alongside buffered rows so pagination does not discard their revisions.

There is no destructive timestamp migration: timestamps cannot be safely converted
into native turn positions/revisions. Existing browser data remains available for
servers or imported rows that do not supply receipts, but does not determine unread
status for rows with native receipts. Native state changes are shared only among
clients of the same durable server state, not arbitrary remote Codex installations.

## Performance audit

Code-path audit: receipts piggyback on existing paginated thread/list calls; no
new history reads, scans, timers or startup requests. Mark-read performs at most
one concurrent update per thread and skips already-read receipts. Notifications
reuse existing row flag application. Pager payload grows by one small receipt per
eligible buffered row. Browser timing and live cross-client behavior were not measured.

## Remaining work

Verify a real deployment's version, durable read receipts and conflict behavior.
Decide explicit user-facing section/pin semantics before moving existing threads.
Offer a reviewed prompt-to-Skill conversion only with preservation of source files
and unsupported template semantics. No native worktree lifecycle should be assumed
from CLI or desktop UI commands.

The source implementation in `app-server/src/request_processors/thread_read_state.rs`
requires a local state database and excludes ephemeral, subagent, unknown-source,
and non-user-source threads. Missing receipts are therefore a per-row compatibility
signal, not proof that the entire server lacks the API.

## Executed verification

- Full unit suite: 79 files, 1,197 tests passed.
- Focused gateway/desktop suite: 231 tests passed before the final presentation-only
  error handling adjustment; the full suite was rerun afterward.
- TypeScript checks passed; production build passed, including a final rebuild.
- External app-server fixture passed HTTP RPC, metadata, browser WebSocket,
  connection ownership, and listener-survival checks. This is not a real Codex server.
- No live authenticated Codex, cross-client, browser/theme, or destructive worktree
  tests were performed. No user data was changed.
