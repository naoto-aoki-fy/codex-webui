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
