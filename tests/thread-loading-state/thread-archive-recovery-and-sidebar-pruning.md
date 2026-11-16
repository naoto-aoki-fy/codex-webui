### Thread archive recovery and sidebar pruning

#### Feature/Change Name
Deleting a thread recovers from Codex `no rollout found` archive failures and removes successfully archived threads from the sidebar immediately.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Codex CLI available on `PATH`
3. At least one normal thread and one newly-created thread that has not yet produced a rollout
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, create a new empty thread from the sidebar.
2. Open that thread's menu and choose `Delete thread`.
3. Confirm the thread disappears from the sidebar without a `no rollout found` error.
4. Rename another visible thread, then delete it.
5. Confirm the renamed thread disappears immediately and does not reappear after sidebar refresh/background pagination.
6. Call `thread/list` with `archived:false` through `/codex-api/rpc` and confirm the deleted thread ids are absent.
7. Call `thread/list` with `archived:true` and confirm the deleted thread ids are present.
8. Switch to dark theme and repeat steps 1-5.

#### Expected Results
- Empty or not-yet-materialized threads are archived after CodexUI sets a fallback name and retries.
- Already archived threads are treated as archived instead of surfacing a stale `no rollout found` error.
- The sidebar prunes archived ids from its accumulated paginated list before refreshing.
- Older unarchived threads may appear as the list refills, but archived threads do not remain visible.
- Behavior is consistent in light and dark themes.

#### Rollback/Cleanup
- None.

## Archived conversations Settings category and restore

Setup: use a credential-free server fixture with more than 50 archived threads,
native project IDs, and controllable `thread/unarchive` failures.

1. Open home; verify no `archived: true` list request and no standalone
   **Archived conversations** button in the sidebar. Open **Settings**; verify
   General, Codex account, Apps / Connectors, Archived conversations and About
   appear as categories. Opening Settings or selecting other categories must not
   request archives.
2. Select **Archived conversations**; verify the list renders in the Settings
   content area with exactly one open dialog and a loading indicator while the
   request is pending. Load another page; verify opaque cursor forwarding and no
   duplicate rows. Refresh/Restore/Load more must be disabled while busy.
3. Switch between every Settings category and back, then close and reopen Settings
   using both the Close button and Escape. Expect normal navigation, focus return,
   cached rows and pagination, and no additional archive reads. Returning while the
   first request is pending must not start a duplicate request.
4. Click **Refresh archived conversations**; verify one first-page request replaces
   the cached list and resets pagination. Load another page again.
5. Restore a named archived thread in an older native project. It disappears from
   archived rows and appears under that same project with its original ID/name.
6. Reload and reopen Settings → Archived conversations: the server's restored
   thread remains active. Open it and verify original history, pins/read state
   and metadata remain native.
7. Reject a restore: the row remains, an error appears, and no active row is invented.
8. Return an empty page, method-not-found, permission error and disconnect during a
   page: verify distinct empty/error text and no stale results after reconnect.
   Refresh after a failure to verify recovery. A failed initial load must not show
   the empty-state message. After a connection change, revisiting the category
   must fetch current data instead of reusing invalidated rows.
9. Check the Settings archive list, navigation and actions in light/dark at desktop,
   375×812 and 768×1024. Long conversation titles must wrap without horizontal
   overflow, and Settings must remain scrollable with its close control visible.

Cleanup: restore fixture state. No permanent deletion or archive index is added.
Performance: zero startup archive calls or additional reads on cached category and
dialog visits; one 50-row RPC per requested page or explicit refresh, serial
requests and deduplicated rows. The mounted panel retains pages until refresh or
connection-epoch invalidation. Restore uses one mutation and the existing forced
active-list refresh; no new subscriptions, polling, blocking work or unbounded
request fanout. Synthetic browser checks verify these request counts; live latency
was not measured.


## Preserve post-restore native metadata

Setup: fixture returning an unarchive response followed by a fresher active-list
row with a different title and a native read-state revision.
Actions: restore the conversation and finish the active-list refresh.
Expected: the fresher title and native read receipt remain; an older restored row
outside the returned first page still appears under its native project.
Cleanup: reset fixture responses. Automated regression: `useDesktopState.test.ts`.
Live limitation: an empty disposable thread on codex-web-local/0.169.0 restored
successfully but was omitted by the native active list after refresh. Do not add
a client index or generate a paid turn to conceal it; repeat normal-history
acceptance with explicitly designated nonempty test history.
