# Toolbar new thread keeps active project

## Feature/Change Name
The global Start new thread action opens the new-thread composer with the active thread's project selected.

## Prerequisites/Setup
1. Start local Vite: `pnpm run dev --host 127.0.0.1 --port 4173`.
2. Use a workspace with at least one project-backed thread.

## Steps
1. In light theme, open `http://127.0.0.1:4173/#/`.
2. Select a thread inside a project from the sidebar.
3. Click the toolbar Start new thread button.
4. Confirm the home/new-thread composer opens with the same project folder selected, not an empty or projectless selection.
5. Send a first message and confirm the new thread appears under the same project in the sidebar.
6. While already on the home/new-thread route with a folder selected, click Start new thread again and confirm the selected folder is not cleared.
7. Repeat the selection and Start new thread flow in dark theme.

## Expected Results
- The toolbar Start new thread action preserves the active thread's project context.
- The new-thread folder dropdown shows the project folder immediately after navigation.
- Existing home-route folder selection is preserved when no active thread project resolves.
- New threads created from that composer are grouped under the same project.
- Light and dark theme controls remain readable.

## Rollback/Cleanup
- Stop the temporary Vite server if it was only used for this check.

## Project selection background

### Prerequisites/Setup
- Register two folders with the same leaf name but different full paths, a project with threads, and an empty project. Include an empty same-name folder and a registered project with only worktree threads if available.
- Use the project view with the sidebar expanded. Run every case in light and dark themes.

### Actions and Expected Results
1. Select a project-backed thread, then a thread in another project. Exactly one project header has the selection background, spanning its icon, normal-weight name, and action buttons. It matches the selected thread: `bg-zinc-200` in light mode and `bg-zinc-800` in dark mode.
2. Collapse the selected thread's project, expand it, pin the thread, and collapse the Pinned section. The owning project's header stays highlighted throughout.
3. Search for text that excludes the selected thread, including a query with no results. The active project header remains highlighted and shows `No matching threads` when appropriate. Clear search; thread selection and project expansion still work.
4. Click the toolbar Start new thread action. The retained project folder determines the highlight. Change folders in the composer dropdown; the highlight moves immediately.
5. Select each same-name folder separately, including the empty one. Only the project with the matching full path is highlighted. Select the uniquely named empty project and confirm it also highlights without creating a thread.
6. Select the canonical folder of a registered project that has only worktree threads. Its project header highlights.
7. Use the Chats section's new-chat action to clear the folder selection. No project is highlighted. For a developer-level unmatched-folder check, emit `update:modelValue` with an unregistered path from the folder dropdown in Vue DevTools; no project should highlight, even if the path shares an existing project's leaf name. Emit an empty value to verify deselection.
8. Open Skills; no project is highlighted. Return to a thread and verify its project highlights again.
9. Change the project sort order and open/close project headers and menus. Existing ordering, collapse, actions, and thread selection remain functional.

### Rollback/Cleanup
- Clear search, unpin temporary pins, and restore project ordering, expansion, and theme preferences. Remove only fixture projects created for this check. Leave the shared verification server on port 4173 running.
