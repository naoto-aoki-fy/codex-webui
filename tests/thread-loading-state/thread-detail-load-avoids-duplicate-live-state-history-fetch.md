### Thread detail load avoids duplicate live-state history fetch

#### Feature/Change Name
Normal thread detail loading calls `thread/read` directly instead of first calling `/codex-api/thread-live-state`, which is now retired with JSON 404.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Browser dev tools Network panel open
3. An existing thread with a large history

#### Steps
1. Open the existing thread
2. Inspect network/RPC calls during the message load

#### Expected Results
- The message load performs `thread/read` or `thread/resume` for the thread
- It does not first call `/codex-api/thread-live-state` for the same normal message load
- Messages and active/in-progress state still render correctly

#### Rollback/Cleanup
- None

---

### Retired file-change fallback API

Prerequisites: run the current app in development or from a built package; use a disposable Git project and thread containing add, modify, delete, and move patches.

1. Request `/codex-api/thread-file-change-fallback` with and without `?threadId=<id>`, including GET, HEAD, and POST.
2. Expect HTTP 404 and JSON content type (HEAD has no body); GET/POST return `{"error":"Not found"}`, never application HTML or a successful empty data response.
3. Open a thread with more than 10 turns and load earlier messages. Expect bounded initial history, ordered earlier pages, and no requests to the retired path.
Conversation revert uses native Codex history operations and never restores local files. File diffs remain inspectable; file Undo/Redo has been removed.

Cleanup: discard only the disposable fixture project and close diagnostics. Leave real sessions intact. The retirement is an intentional compatibility break with no replacement endpoint.

### Retired live-state diagnostic API

Prerequisites: current development or built app; disposable thread with more than 10 turns.

1. Request `/codex-api/thread-live-state` using GET, HEAD and POST, with and without `?threadId=<id>`.
2. Expect HTTP 404 JSON content type; GET/POST return `{"error":"Not found"}`, never frontend HTML. HEAD has no body.
3. Load normal history and earlier pages; expect one initial `thread/read`, zero diagnostic requests, stable order and no duplicates.
4. Verify timestamp, execution metadata, selected skills, inline media and streamed failure messages remain visible after reload.
5. During pending first-turn materialization, expect empty in-progress normal RPC history. A recognized empty-rollout failure can reuse a saved snapshot.

Cleanup: archive only disposable threads and restore theme. No replacement exists for the removed diagnostic command/file-change reconstruction.

## Native history without local session enrichment

Setup: existing conversation with skill inputs, images and an attachment-only first turn.
Actions: reopen, reload and reconnect; inspect history and submit another turn.
Expected: native history remains visible; first-turn recovery and duplicate-send prevention remain active. No local session log scan or codexapp-turn-metadata JSONL write occurs. Live response model/reasoning labels still use submitted settings.
Cleanup: remove only test conversations if desired; retain existing metadata files.
Performance: eliminates unused session parsing/cache implementations and one filesystem append per accepted turn; native history requests remain unchanged. Live timings were not measured.

## Native pagination compatibility boundary

Setup: disposable native RPC fixture. Run
`pnpm exec vitest run src/server/remoteHistoryPager.test.ts
src/server/threadLiveStateRetirement.test.ts src/server/threadFileChangeRetirement.test.ts
src/server/projectHistory.test.ts src/server/conversationTransfer.test.ts
src/composables/useDesktopState.test.ts`.

Expect native recent/older pages with absolute positions and unchanged fork
cutoffs, coalesced metadata indexes, notification invalidation and preserved
inline media/errors. An adapter lacking the native pager must return a clear
compatibility error without a full read. Explicit method-not-found is an upgrade
failure; permission, transport and malformed responses remain distinct. Portable
transfer full reads and revert/fork-and-revert still execute their supported
entry points. No fixture operates on real history. Cleanup is automatic for
fixture homes; do not delete real conversations or restart the persistent server.
