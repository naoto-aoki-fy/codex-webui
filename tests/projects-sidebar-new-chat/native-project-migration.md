### Feature: Native Project operations and ID-based sidebar grouping

Setup: use a disposable local CODEX_HOME/profile and an independently managed
App Server with native Projects. Create native Projects and disposable threads,
including two Projects with the same name/roots, an empty Project and an
unassigned thread. Seed a historical root or receipt in the disposable local
profile and record its bytes.

Actions and expected results:

1. Open the sidebar and reload. Labels, roots and order follow the native
   Project records. Threads are grouped by their explicit native IDs. Changing
   a thread's cwd alone leaves its membership unchanged.
2. Rename and move a Project. Reload and verify its identity, order, and thread
   association. A Portable Fork destination retains its imported transcript.
3. Start a conversation from a Project with a valid root. Inspect
   `thread/start.projectId` and `cwd` for the explicit selected values.
4. Remove a disposable Project. Its threads become unassigned and its files
   stay intact. Compare the old local record with its original bytes.
5. Return method-not-found from `project/list`. Expect upgrade guidance.
   Permission and transport failures remain visible in the Projects UI.

Cleanup: archive only disposable threads, remove only disposable native projects
and fixture files, and restore the original theme.

### Regression: visible native Project Remove menu

Setup: start the current checkout with `pnpm run dev --host 127.0.0.1 --port 4173`.
Run `node scripts/test-sidebar-project-menu.cjs` with Playwright Chromium installed.
The automated check loads the app with intercepted API calls and exercises fixture deletion.
It checks both themes at desktop, tablet, and mobile sizes, link navigation and reloads,
group toggling, keyboard focus, menu dismissal, and the exact project ID sent by Remove.
Screenshots are saved under `output/playwright/sidebar-links-<width>-<theme>.png`.

For live deletion, use a disposable profile with a native Project, a conversation
assigned to it, a workspace file, and an Unassigned conversation:
1. In light theme, hover the disposable Project and click its three-dot menu.
   Expect a visible, readable Remove button. Click it. Expect the Project to disappear
   while its conversation remains accessible in Unassigned and the file is intact.
2. Refresh. Expect the Project to remain absent and conversation contents intact.
3. Repeat with a second disposable Project in dark theme. Open its three-dot menu
   and verify readable text on a dark panel before removing it.
4. Open the three-dot menu for Unassigned. Verify **Open in new tab** is available
   and **Remove** is absent. Repeat for a stale project ID if the fixture supports one.

Cleanup: restore the original theme, archive only disposable conversations, and
remove only disposable files/profile data. The automated fixture uses a fresh
browser context per theme and requires no native Project cleanup.
