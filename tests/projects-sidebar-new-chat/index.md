# Projects, Sidebar, and New Chat

Home route, project picker, sidebar organization, new-chat setup, explicit folders, and project/worktree shell behavior.

Return to the [manual test index](../../tests.md).

## Test Sections

| Section |
| [Existing workspace and native conversation workflows](native-workspace-workflows.md) |
| --- |
| [New-thread composer requires a folder](composer-requires-folder.md) |
| [Explicit folders and removal of legacy Chats](remove-projectless-chats.md) |
| [Concurrent project state updates and stale responses](concurrent-project-state-updates.md) |
| [Feature: Empty project new thread action](empty-project-new-thread-action.md) |
| [Feature: Remove GitHub trending projects from the new-thread screen](remove-github-trending-projects-from-the-new-thread-screen.md) |
| [Feature: Runtime selector uses a toggle-style control](runtime-selector-uses-a-toggle-style-control.md) |
| [Feature: Frontend missing-entry 404 page auto-redirects to chat](frontend-missing-entry-404-page-auto-redirects-to-chat.md) |
| [Editable current folder path in the folder picker](editable-current-folder-path-in-the-folder-picker.md) |
| [Expandable Projects, Pinned, and Chats sidebar sections](expandable-projects-pinned-and-chats-sidebar-sections.md) |
| [Sidebar sessions survive symlinked workspace roots](sidebar-sessions-survive-symlinked-workspace-roots.md) |
| [Sidebar scroll position survives collapse](sidebar-scroll-position-survives-collapse.md) |
| [Toolbar new thread keeps active project](toolbar-new-thread-keeps-active-project.md) |

| [Projects and history without ZIP import/export](projects-and-history-without-zip.md) |

## Compact Skills toolbar action

- Setup: Open the app with the sidebar expanded.
- Actions: Click the Skills icon beside Search; repeat with keyboard navigation and on mobile. Check both light and dark themes.
- Expected: The icon opens the Skills route, exposes a translated label and tooltip, and marks the active route with `aria-current="page"` and active styling. Mobile navigation closes the sidebar. The previous full-width cards are absent; search and new-thread actions still work.
- Cleanup: Return to the home route and restore the original theme. No persistent data is changed.

- [Native Project migration and ID-based sidebar grouping](native-project-migration.md)
