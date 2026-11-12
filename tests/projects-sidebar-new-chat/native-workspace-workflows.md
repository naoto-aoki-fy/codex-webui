# Existing workspace and native conversation workflows

Prerequisites: Use disposable existing directories with a Git repository and an external Codex app-server. Keep a text file and an image for attachments. Repeat UI checks in light and dark themes.

1. Open Home. Verify only existing folder selection is offered; project creation, GitHub cloning, and New folder controls are absent.
2. Submit without selecting a workspace. Expect a clear selection error and no new directory under Documents/Codex.
3. Browse, select, and switch between two existing directories. Reload. Expect both roots and their histories to remain accessible, including roots with legacy alias/order metadata.
4. Verify project rename and manual drag/keyboard ordering are absent. Thread renaming remains available.
5. Create and resume a conversation. Attach a normal file and image using Add photos & files. Expect both to submit and remain in history; folder upload and camera capture are absent.
Conversation revert uses native Codex history operations and never restores local files. File diffs remain inspectable; file Undo/Redo has been removed.
7. Modify that file externally, record its bytes and Git status, then revert a turn and fork/revert another turn. Expect native history changes with identical local file bytes and Git status.
8. Call retired creation, clone, and rollback endpoints. Expect JSON 404, no filesystem changes, and no Codex RPC calls.

Cleanup: Delete only the disposable fixtures you created using normal filesystem tools. Unregistering a project must not delete its directory. Restore the original theme. Native thread history changes cannot be undone by this app.
