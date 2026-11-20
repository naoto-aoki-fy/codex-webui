# Thread titles without redundant generation

Prerequisites: run the app with a working app-server and a writable project. Open browser network tools and keep the request log across reloads.

1. Create a thread and send a message. Confirm the provisional title remains visible and no RPC request uses `generate-thread-title`.
2. Rename the thread manually, reload, and confirm the saved title persists.
3. Let the app-server emit a `thread/name/updated` notification. Confirm its title appears in the sidebar.
4. Reopen an existing thread with attachments and file changes. Confirm history and file-change cards still render; exercise rollback on a disposable turn.
5. Send a test `generate-thread-title` RPC to a disposable fixture. It follows the
   upstream unknown-method error path; it no longer returns a fabricated empty title.
   Concurrent `account/read` and native `thread/name/set` calls must still succeed.
6. Request an unknown `/codex-api/` route with GET, HEAD, POST and OPTIONS.
   Expect 404 and JSON content type (HEAD has no body), never SPA HTML. Old login
   POSTs retain 409 external-authentication guidance.
7. Check both light and dark themes. No layout or styling changes are expected.

Cleanup: delete the disposable thread and restore the original theme. These steps are a manual checklist, not a record of an automated browser run.

## Background conversations, Goals, and pending requests

Prerequisites: open the same disposable conversation in two tabs, A and B, in the same browser window. Keep both connected to the App Server and use a prompt that takes long enough to switch tabs before it finishes. For the Goal and request cases, use a Goals-enabled server or a fixture that can emit `thread/goal/updated`, `thread/goal/cleared`, `turn/completed`, and `server/request` events. Record the initial title and favicon in the tab strip. In A, preserve the Network panel log and filter it to `/codex-api/`.

1. In tab A, send a prompt and stay on A until the turn completes. The title and favicon should stay unmarked.
2. Send another prompt in A and switch to B while it runs. After the turn completes, check the browser tab strip without activating A. Tab A should have one `*` before the title and a red dot in the upper-right corner of the favicon. Tab B should stay unmarked.
3. With A still hidden, send another prompt from B and let it finish. Tab A should still have one `*` and one dot. Rename the conversation from B and wait for the updated title to appear in A. Both indicators should remain active.
4. Return to A. The `*` should disappear immediately, the renamed title should remain, and the original favicon should return. Open another conversation and return to confirm that both indicators stay cleared.
5. In B, open a different disposable conversation and let a turn finish while A is hidden. Tab A should stay unmarked.
6. In A, start a Goal and switch to B while it is active. Let an intermediate turn succeed. A stays unmarked. Repeat with a turn that fails and one that is interrupted while the Goal remains active. Each marks A once. If the same `turnId` also produces a Goal pause, viewing A to clear the indicators and switching back to B before the second event must leave A unmarked.
7. With A hidden, have the Goal complete. Repeat starting from an active Goal for `paused`, `blocked`, `usageLimited`, and `budgetLimited`. Each transition marks A, and the Goal panel in A reflects the event. After clearing the indicators, send an ordinary response in the same conversation and switch to B. Its successful completion or failure marks A as before. Clear an active Goal while its turn is running. Clearing the Goal and a successful end to its current turn leave A unmarked. The following normal response marks A.
8. While A is hidden during a Goal turn, trigger a Codex question, an MCP input request, and command, file, and permission approvals. For each request, verify that A is marked before the turn ends, then view A, confirm the request, and switch back to B. Repeat with two new IDs in the same turn. A duplicate ID or a question pending confirmation after submission leaves A unmarked. Finish the Goal in the same turn after the last confirmation and check that A is marked again.
9. View A to clear both indicators, then reopen the conversation or reconnect A with a previously stopped Goal and a pending approval already on the server. The panel and approval are restored with no indicators. Verify that a new request received while A remains hidden still marks it, and that requests in B's other conversation never mark A. Navigate away from a marked conversation in A and check that the title and favicon reset. In a fixture, delay the reconnect Goal read, end an ordinary turn while A is visible, switch to B, and release the read. A should stay unmarked.
10. For a server with Goals disabled or unavailable, repeat the ordinary completion and failure checks. Repeat the indicator checks in light and dark themes. In the Network panel, a live Goal or pending request event by itself should add zero API requests. Selection and reconnect read the selected Goal, and normal turn/history synchronization continues.

Cleanup: resolve or dismiss disposable requests, clear the test Goal, close the duplicate tab, delete the disposable conversation, and restore the original theme.
