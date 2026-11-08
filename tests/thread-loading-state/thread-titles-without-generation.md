# Thread titles without redundant generation

Prerequisites: run the app with a working app-server and a writable project. Open browser network tools and keep the request log across reloads.

1. Create a thread and send a message. Confirm the provisional title remains visible and no RPC request uses `generate-thread-title`.
2. Rename the thread manually, reload, and confirm the saved title persists.
3. Let the app-server emit a `thread/name/updated` notification. Confirm its title appears in the sidebar.
4. Reopen an existing thread with attachments and file changes. Confirm history and file-change cards still render; exercise rollback on a disposable turn.
5. Check both light and dark themes. No layout or styling changes are expected.

Cleanup: delete the disposable thread and restore the original theme. These steps are a manual checklist, not a record of an automated browser run.
