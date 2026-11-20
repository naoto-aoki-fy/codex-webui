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

## Background turn completion in the tab title

Prerequisites: open the same disposable conversation in two tabs, A and B, in the same browser window. Keep both connected to the app-server and use a prompt that takes long enough to switch tabs before it finishes. Record the initial conversation tab title.

1. In tab A, send a prompt and stay on A until the turn completes. Tab A's title should have no marker.
2. Send another prompt in A and switch to B while it runs. After the turn completes, check the browser tab strip without activating A. Tab A should have exactly one `*` before the title, and the visible tab B should stay unmarked.
3. With A still hidden, send another prompt from B and let it finish. Tab A should still have one `*`. Rename the conversation from B and wait for the updated title to appear in A. The new title should retain the prefix.
4. Return to A. The `*` should disappear immediately and the renamed title should remain. Open another conversation and return to confirm that the marker stays cleared.
5. Repeat in both light and dark themes.

Cleanup: close the duplicate tab, delete the disposable conversation, and restore the original theme.
