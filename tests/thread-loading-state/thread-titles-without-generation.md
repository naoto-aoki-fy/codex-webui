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

## Background turn completion in the tab title and favicon

Prerequisites: open the same disposable conversation in two tabs, A and B, in the same browser window. Keep both connected to the app-server and use a prompt that takes long enough to switch tabs before it finishes. Record the initial title and favicon in the tab strip.

1. In tab A, send a prompt and stay on A until the turn completes. The title and favicon should stay unmarked.
2. Send another prompt in A and switch to B while it runs. After the turn completes, check the browser tab strip without activating A. Tab A should have one `*` before the title and a red dot in the upper-right corner of the favicon. Tab B should stay unmarked.
3. With A still hidden, send another prompt from B and let it finish. Tab A should still have one `*` and one dot. Rename the conversation from B and wait for the updated title to appear in A. Both indicators should remain active.
4. Return to A. The `*` should disappear immediately, the renamed title should remain, and the original favicon should return. Open another conversation and return to confirm that both indicators stay cleared.
5. In B, open a different disposable conversation and let a turn finish while A is hidden. Tab A should stay unmarked.
6. Repeat in both light and dark themes.

Cleanup: close the duplicate tab, delete the disposable conversation, and restore the original theme.
