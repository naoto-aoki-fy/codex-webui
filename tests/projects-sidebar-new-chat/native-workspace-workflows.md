# Existing workspace and native conversation workflows

Prerequisites: Use disposable existing directories with a Git repository and an external Codex app-server. Keep a text file and an image for attachments. Repeat UI checks in light and dark themes.

1. Open Home. Verify only existing folder selection is offered; GitHub cloning and New folder controls are absent. Registering an existing folder creates a native Project when needed.
2. Submit without selecting a workspace. Expect a clear selection error and no new directory under Documents/Codex.
3. Browse, select, and switch between two existing directories. Reload. Expect both roots and their histories to remain accessible, in native Project order.
4. Open the project menu. Rename it and use Move up or Move down. Reload and confirm the new name and order persist. Remove a disposable project and confirm its folder still exists. Thread renaming remains available.
5. Create and resume a conversation. Attach a normal file and image using Add photos & files. Expect both to submit and remain in history; folder upload and camera capture are absent.
6. Conversation revert uses native Codex history operations and never restores local files. File diffs remain inspectable; file Undo/Redo has been removed.
7. Modify that file externally, record its bytes and Git status, then revert a turn and fork/revert another turn. Expect native history changes with identical local file bytes and Git status.
8. Call retired creation, clone, and rollback endpoints. Expect JSON 404, no filesystem changes, and no Codex RPC calls.

Cleanup: Delete only the disposable fixtures you created using normal filesystem tools. Unregistering a project must not delete its directory. Restore the original theme. Native thread history changes cannot be undone by this app.

## Existing directories without automatic worktree creation

Prerequisites: existing local project, existing worktree, and a conversation in each.
Actions: select each directory, send a turn, switch projects, reload, and reopen both conversations.
Expected: cwd associations, empty saved folders, labels and ordering survive. No worktree creation or starting-branch UI appears. No branches or directories are created/deleted. Codex supplies the native project names, roots and positions.
Cleanup: restore sidebar ordering and remove only test conversations if desired.
Performance: project and thread listing start in parallel, and continuing background history pages reuse the current native project list.

## Retired presentation styles

Prerequisites: current build, a compatible test server, and a disposable browser
profile. No workspace mutation is needed.

1. Open home and the existing-folder picker. Check keyboard focus, loading/error
   states and path controls in light/dark themes at desktop and narrow widths.
2. Open `/` with hash route `#/skills`, expand MCP details and an installed skill.
   Verify card text, enabled-state badges, details and buttons retain their theme.
3. Confirm no retired runtime toggle, automatic-worktree progress or project
   creation modal is displayed. Existing-folder selection and native management
   entry points remain usable.

Expected: only unreachable styles are removed; active folder-picker, Skills and
MCP presentation remains. Cleanup: close the picker/details, restore the original
theme and close the disposable profile. Do not delete any workspace or skill data.
