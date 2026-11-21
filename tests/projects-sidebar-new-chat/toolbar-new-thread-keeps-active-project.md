# Toolbar new thread keeps active project

## Feature/Change Name
The global **Start new thread** pencil opens the new-thread composer in the current tab. Middle-click, Ctrl/⌘-click, and **Open in new tab** carry the same folder selection to a separate tab.

## Prerequisites/Setup
1. Start local Vite: `pnpm run dev --host 127.0.0.1 --port 4173`.
2. Register a project whose root contains Japanese characters, spaces, `#`, and `&`. Have one thread in a separate worktree, one with a project ID whose root is unavailable, one unassigned with a cwd, and one without a cwd.
3. Open DevTools Network with **Preserve log** and filter for `codex-api`. Load an ordinary home tab as the initialization baseline. Repeat the menu checks in light and dark themes at 1280×900, 375×812, and 768×1024.

Run `node scripts/test-toolbar-new-thread.cjs` against the same Vite server for the automated browser fixture. Add `--firefox` to run with Playwright's Firefox build.

## Steps
1. Open the worktree thread from `http://127.0.0.1:4173/#/` and type an unsent draft. Record its URL and selected row.
2. Right-click the pencil. Press Down Arrow to check focus on **Open in new tab**, then Esc to close and return focus to the pencil. Right-click the arrow and click outside to dismiss the same menu. Click the arrow to open it again. Shift-right-click the pencil and arrow to check the browser context menu. Compare the API request count before and after these menu interactions.
3. Focus the arrow, press Down Arrow, then press Enter on **Open in new tab**. Repeat with a middle-click and Ctrl-click (⌘-click on macOS) on the pencil. In each new tab, check the registered project root and `projectId` in the home URL, check the folder selection, and compare startup requests with the regular home tab. Reload a new tab and check the selection again.
4. Return to the original tab and compare its URL, selected row, and draft with step 1. Send a first message in one new tab and verify that its thread appears in the registered project.
5. Click the pencil normally on the worktree thread. On the resulting home screen, select a different project and open another tab with the arrow. Click the pencil normally on home again and check that the new selection is still in use.
6. Repeat ordinary and new-tab opening from a thread whose project root is unavailable, an unassigned thread with a cwd, and a thread with an empty cwd. First use a home URL with a selected folder so the empty-cwd case also checks against inheriting a stale selection.
7. Repeat the menu checks with the sidebar expanded and collapsed. At 375×812, use both the content header and the open mobile drawer.

## Expected Results
- Normal clicks navigate in the current tab. New-tab actions leave the original tab's URL, selected thread, and draft intact.
- A registered project root takes priority over a worktree cwd. An unavailable root falls back to the thread cwd, and an unassigned thread carries only its cwd. An empty cwd opens **Choose folder**. Opening from home carries the current folder and any selected project ID.
- The full path survives URL encoding and reload. Opening and closing the menu makes zero API requests. A new tab runs one regular home initialization, and `thread/start` and `turn/start` first appear when the first prompt is submitted.
- Each toolbar location shows the same readable menu, fully within the viewport and operable using the keyboard.

## Rollback/Cleanup
- Close the test tabs, restore the theme and sidebar preferences, and remove only disposable fixture projects and threads. Leave the shared verification server on port 4173 running.

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

## Home folder URL reflection and restoration

### Prerequisites/Setup
- Use the verification server on port 4173 and two registered folder candidates.
- Repeat in light and dark themes. Include a full path containing Japanese characters, spaces, `#`, and `&`.

### Actions and Expected Results
1. Select a folder in Start new thread. The home URL contains `cwd` with the full path encoded by Vue Router. Modify the folder repeatedly; each change replaces the current history entry.
2. Reload and wait for the candidate list to load. The dropdown shows the project name. Selected folder shows the folder basename. The full path remains in the URL and in both controls’ tooltips.
3. Open a home URL with an unregistered `cwd`. Both controls show the folder basename and retain the full path in their tooltips. Reload and confirm the selection remains after candidates arrive. No folder is registered or created.
4. Navigate between home URLs with different `cwd` values, then use Back and Forward. The selected folder follows each URL. An absent or empty `cwd` clears selection.
5. From a project thread, use toolbar Start new thread and project-specific new creation. Both push a home entry carrying the resolved project path. Chats new-chat pushes home without `cwd`.
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
