### Feature: Native Project migration and ID-based sidebar grouping

Setup: use a disposable local CODEX_HOME/profile and a test App Server. Save legacy
roots including an empty project, duplicate folder names, labels and explicit
ordering; create active and archived disposable threads and a Portable Fork
receipt. Never seed or change existing user conversations for these tests.

Actions and expected results:
1. Open the sidebar. Native project/import creates each legacy project once,
   preserving names, roots and relative order, including the empty project.
   Active and archived members have the correct native project IDs.
2. Interrupt a migration after import acceptance or during ordering. Restart the
   backend and retry. The frozen input is reused, project IDs remain stable,
   missing associations are repaired and no project is duplicated.
3. Restart after completion. Rename/reorder a native project and delete a
   disposable native project. Refresh again; legacy input must not recreate or
   overwrite it. Compare legacy fields and transfer receipts byte-for-value.
4. Give two native projects identical names/roots and move one member's cwd.
   Sidebar membership follows IDs, not paths. Unassigned conversations remain
   visible as Unassigned. Imported transcript content remains visible on reload.
5. Choose an empty project and start a thread. Inspect thread/start.projectId and
   cwd. Both must match the explicit selection. Refresh home and confirm the
   selected project ID and cwd survive in the route. Check light/dark themes.
6. Return -32601 from project/list before migration. Expect explicit read-only
   compatibility guidance and rejected project writes. Repeat with transport
   failure, permission error, unsupported import and ignored move/association:
   expect a specific migration failure, not writable legacy fallback.
7. Seed conflicting existing native membership. Migration must identify the
   exact conflicting association and preserve it until deliberately resolved.

Cleanup: archive only disposable threads, delete only disposable native projects,
stop fault injection and restore theme. Preserve original rollouts and legacy
metadata/project stores. Discard the disposable local profile deliberately.

### Regression: visible native Project Remove menu

Setup: start the current checkout with `pnpm run dev --host 127.0.0.1 --port 4173`.
Run `node scripts/test-sidebar-project-menu.cjs` with Playwright Chromium installed.
The automated check mounts the real sidebar and application CSS with isolated
fixture props and intercepted API calls; it does not exercise backend deletion.
It checks both themes, a visible/interactable Remove button, the emitted native
ID, menu dismissal, right-click access, missing/stale IDs, and ID invalidation.
Screenshots are saved under `output/playwright/sidebar-project-menu-{light,dark}.png`.

For live deletion, use a disposable profile with a native Project, a conversation
assigned to it, a workspace file, and an Unassigned conversation:
1. In light theme, hover the disposable Project and click its three-dot menu.
   Expect a visible, readable Remove button. Click it. Expect the Project to disappear
   while its conversation remains accessible in Unassigned and the file is intact.
2. Refresh. Expect the Project to remain absent and conversation contents intact.
3. Repeat with a second disposable Project in dark theme. Right-click its header
   to open the menu; expect readable text and a dark panel before removing it.
4. Right-click Unassigned. Expect no project menu or three-dot trigger. Its
   new-thread control remains available. Repeat for a stale project ID not present
   in the native Project list if the fixture supports one.

Cleanup: restore the original theme, archive only disposable conversations, and
remove only disposable files/profile data. The automated fixture uses a fresh
browser context per theme and requires no native Project cleanup.
