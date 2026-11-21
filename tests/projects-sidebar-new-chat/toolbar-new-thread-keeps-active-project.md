# Toolbar new thread keeps active project

## Feature/Change Name
The global Start new thread action opens the new-thread composer with the active thread's project selected.

## Prerequisites/Setup
1. Start local Vite: `pnpm run dev --host 127.0.0.1 --port 4173`.
2. Use a workspace with at least one project-backed thread.

## Steps
1. In light theme, open `http://127.0.0.1:4173/#/`.
2. Select a thread inside a project from the sidebar.
3. Click the toolbar **Start new thread** link.
4. Confirm the home/new-thread composer opens with the same project folder selected, not an empty or projectless selection.
5. Send a first message and confirm the new thread appears under the same project in the sidebar.
6. While already on the home/new-thread route with a folder selected, right-click **Start new thread** and copy its address. Verify Ctrl/Cmd+click and middle-click open the same folder in a new tab and reload the new tab. Click normally again and verify the selected folder remains.
7. Repeat the flow with the mobile header at 375×812, with its drawer open. A normal click or keyboard activation closes the drawer. Repeat in dark theme and verify a visible keyboard focus outline.
8. In a fixture with a pinned thread outside the loaded thread list, open that thread in a new tab and reload it. Once its conversation loads, verify **Start new thread** still points to its workspace. The older pin's three-dot menu opens and allows **Open in new tab**.

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
3. Open sidebar search and select **Thread Name**. Enter a query with no results and wait for **No results found**. The toolbar's new-thread link still points to the active project. Clear the query to restore the highlighted project header and its previous expansion state.
4. Click the toolbar Start new thread action. The retained project folder determines the highlight. Change folders in the composer dropdown; the highlight moves immediately.
5. Select each same-name folder separately, including the empty one. Only the project with the matching full path is highlighted. Select the uniquely named empty project and confirm it also highlights without creating a thread.
6. Select the canonical folder of a registered project that has only worktree threads. Its project header highlights.
7. Use the Chats section's new-chat action to clear the folder selection. No project is highlighted. For a developer-level unmatched-folder check, emit `update:modelValue` with an unregistered path from the folder dropdown in Vue DevTools; no project should highlight, even if the path shares an existing project's leaf name. Emit an empty value to verify deselection.
8. Open Skills; no project is highlighted. Return to a thread and verify its project highlights again.
9. Change the project sort order and open/close project headers and menus. Existing ordering, collapse, actions, and thread selection remain functional.

### Rollback/Cleanup
- Clear search, unpin temporary pins, and restore project ordering, expansion, and theme preferences. Remove only fixture projects created for this check. Leave the shared verification server on port 4173 running.

## Home folder URL reflection and restoration

### Prerequisites/Setup
- Use the verification server on port 4173 and two registered folder candidates.
- Repeat in light and dark themes. Include a full path containing Japanese characters, spaces, `#`, and `&`.

### Actions and Expected Results
1. Select a folder in Start new thread. The home URL contains `cwd` with the full path encoded by Vue Router. Modify the folder repeatedly; each change replaces the current history entry.
2. Reload and wait for the candidate list to load. The dropdown shows the project name. Selected folder shows the folder basename. The full path remains in the URL and in both controls’ tooltips.
3. Open a home URL with an unregistered `cwd`. Both controls show the folder basename and retain the full path in their tooltips. Reload and confirm the selection remains after candidates arrive. No folder is registered or created.
4. Navigate between home URLs with different `cwd` values, then use Back and Forward. The selected folder follows each URL. An absent or empty `cwd` clears selection.
5. From a project thread, use toolbar **Start new thread** and the owning project's pencil. Each pushes one home history entry carrying the resolved project path. The **Unassigned** link carries only the available workspace `cwd`. The **No working directory** folder link points to bare home.
6. Add an existing folder, create a project, and clone a repository. Each successful selection updates home `cwd`. A successful `openProjectPath` startup takes precedence over an existing home `cwd`.
7. Visit a thread and Skills. Folder state changes must not add `cwd` to either route. Home URL changes must not persist prompt text, model, or runtime settings.

### Rollback/Cleanup
- Restore theme preferences and remove only projects created for this check. Leave the shared verification server running.

## Folder labels in the chat header and browser title

### Prerequisites/Setup
- Use a native Project with a name different from its folder name, two projectless threads with the same folder basename at distinct paths, and a projectless thread with no cwd.
- Include a POSIX path and a Windows path with trailing separators. Repeat in light and dark themes at desktop, 375×812, and 768×1024.

### Actions and Expected Results
1. In **By project**, open each projectless thread with a cwd. The header and browser tab title use the folder basename. Both threads remain under **Unassigned**.
2. Open the projectless thread without a cwd. Its header and tab title show **No working directory**.
3. Open the registered Project’s thread. Its header and tab title show the registered Project name.
4. From a projectless thread with a cwd, click **Start new thread**. The dropdown and **Selected folder** show the basename. Their tooltips and the home URL retain the full cwd. Refresh and confirm these values persist.
5. Switch to **By Folder**. Verify the same-named folders remain distinct and display their full paths.

### Rollback/Cleanup
- Restore the previous grouping and theme preferences and remove only disposable fixture data.
