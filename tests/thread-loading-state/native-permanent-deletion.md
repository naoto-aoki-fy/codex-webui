# Permanent native conversation deletion (10, partial)

Use only credential-free fixtures or explicitly designated disposable native
conversations. No live resource is designated for this implementation pass.

1. Open Conversation tools → Permanent native conversation deletion. Inspect an
   idle native thread with no active or archived child agents. Check exact name,
   native ID, remote cwd, Fork origin and refresh timestamp.
2. Confirm no write occurs during inspection. Try an imported conversation,
   active thread, child subtree, unknown status/filter and changed selection.
   All must prevent deletion. Preserve an unsent draft; inspection must reject
   until it is saved elsewhere or explicitly cleared.
3. Type an incorrect ID and omit confirmation: submit stays disabled. Type the
   exact ID and confirm the irreversible operation including the native race
   caveat; submit once. Child lists and metadata are rechecked before native
   `thread/delete {threadId}`. No filesystem removal or archive fallback occurs.
4. Inject native Fork-reference rejection: show rejection and retain history.
   Inject internal/transport failure: show unknown, block replay, preserve the
   generic RPC error contract for unrelated operations.
5. Acknowledge without event: display accepted, never completed. An unrelated
   deletion event cannot complete this request. Deliver the exact native event
   before or after acknowledgment: completion requires both. Remove only actual
   native-deleted IDs and route home only if the deleted thread is still selected.
6. During pending deletion change connection/profile, selection, or teardown the
   panel. Stale preflight cannot write; late old completion cannot update a new
   operation. Verify late history/subscription reads do not resurrect deleted
   history. Other thread snapshots/subscriptions must survive.
7. Refresh after successful fixture deletion; the native list must still omit it.
   Verify both themes at 1280×900, 375×812, 768×1024.

Run `node scripts/test-risk-deletion.cjs` with the documented Playwright browser
path. Unit suites cover controller, persisted-prefix guard, native cache cleanup,
recovery cancellation, late reads and protected transfer/Fork behavior. Cleanup:
close fixture contexts. Native permanent deletion has no WebUI undo; do not use a
real conversation to test rollback. Imported prefixes and native subtrees remain
outside this limited deletion UI; archive remains available for them.

Input visibility regression: in both themes, inspect the empty exact-ID field
before typing. Expect a visible one-pixel border, theme-appropriate background,
readable text and keyboard focus outline. Worktree destination/branch and model
configuration text inputs use the same scoped styling. No native select is added.

Lazy-loading ownership: delay the first deletion-controller module, click Inspect
on conversation A, then navigate before releasing the module. No preview request
may be sent for replacement conversation B on behalf of the old click. A fresh
explicit Inspect on B must work. Controller tests also enforce captured identity.

Final standalone-command exclusion: while an owned command is pending or uncertain
in another conversation, select a different idle native thread. Permanent deletion
must remain disabled with an explanation, and the controller must send no metadata
or delete RPC. Finish/inspect the original command first. No process is terminated
by deleting, changing selection or showing this guard. Re-run this destructive
workflow's fixture gate after the standalone command suite.
