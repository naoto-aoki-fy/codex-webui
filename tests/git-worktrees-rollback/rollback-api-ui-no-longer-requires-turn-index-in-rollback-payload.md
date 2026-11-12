### Feature: Rollback API/UI no longer requires turn index in rollback payload

#### Prerequisites
- App is running from this repository.
- A thread exists with at least 2 completed turns.
- Rollback control is visible in the thread conversation message actions.

#### Steps
1. Open any existing thread with multiple turns.
2. In DevTools Network tab, keep `/codex-api/rpc` requests visible.
3. Click rollback on a user or assistant message that is not the newest one.
4. Confirm rollback succeeds and the thread is truncated to the selected turn.
5. Inspect the UI event flow by repeating rollback from a different turn and confirm the selected message can rollback without relying on a numeric turn index.
6. Use the "rollback latest user turn" flow and confirm the latest user turn is rolled back correctly.

#### Expected Results
- Rollback works when triggered from message actions using `turnId` as the identifier.
- No UI path depends on `turnIndex` in rollback event payloads.
- Latest-user-turn rollback flow still works and targets the latest user `turnId`.
- No TypeScript/runtime errors are introduced in rollback interaction.

#### Rollback/Cleanup
- Revert the updated files if this behavior is not desired:
  - `src/types/codex.ts`
  - `src/api/normalizers/v2.ts`
  - `src/components/content/ThreadConversation.vue`
  - `src/App.vue`
  - `src/composables/useDesktopState.ts`

### Persisted paginated history migration

Prerequisites: use an independently managed Codex App Server supporting
`thread/revert`, with a persisted paginated thread containing at least 12 turns
and a known file edit. Keep a backup of the edited files.

1. Edit the latest, an earlier, an older-page, and the first user turn in separate
   prepared threads. Inspect RPC requests: each uses `thread/revert` with
   `threadId` and `beforeTurnId`, never a numeric turn count.
2. Confirm the selected turn and all later turns disappear, earlier history
   remains, and the original user text is in the composer. Reload and verify.
3. Try a legacy or ephemeral thread: an explanatory error appears before any
   filesystem restoration.
4. Cause file restoration to report an error: history deletion is not attempted.
   Restore the file backup afterward.
5. Fail the revert RPC after files restore: the error explains partial completion.
   Reload to reconcile history before attempting another edit.
6. Fail the history read after a successful revert: the error identifies refresh
   failure; no second revert request is sent.
7. Revert from another client while an older-page request is pending. Release
   the old request: removed turns must not reappear. Check both light and dark
   themes; the composer and message actions retain their existing styling.

Cleanup: use disposable threads and restore backed-up files. History deletion is
permanent; do not run these cases on conversations that must be preserved.

Performance audit: Phase 1 adds a metadata-only resume plus target validation
before restoration, and one detail read after revert. Validation scans older
pages sequentially only when needed; there is no parallel fanout. Existing
full-history server reads remain a Phase 2 limitation. Snapshot epochs and
desktop read ownership discard pre-revert writes; no browser timing or live
server throughput measurements were taken.
