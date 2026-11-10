### Sidebar sessions survive symlinked workspace roots

#### Feature/Change Name
Workspace roots and thread-list cwd values are canonicalized through local `realpath` before the sidebar filters thread projects and before workspace-root state is written, so sessions remain visible whether they were recorded through a symlink path or its target.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A workspace root registered through a symlink path, for example `/workspace-link/projects/demo`
3. At least one session recorded with the canonical cwd, for example `/storage/projects/demo`
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open the app and wait for the sidebar thread list to load.
2. Confirm a session recorded under the canonical cwd appears in the sidebar.
3. Confirm a session recorded under the symlink cwd also appears in the sidebar.
4. Search for both known session titles and confirm both rows remain findable.
5. Fetch `/codex-api/workspace-roots-state` and confirm local symlink roots are returned as their canonical real paths.
6. If both symlink and canonical forms have saved labels, confirm only the canonical path label is returned and displayed.
7. Add or update a workspace root through the UI using the symlink path, then reload `/codex-api/workspace-roots-state` and confirm the saved root remains in canonical form.
8. Fetch `thread/list` with multiple sessions that share the same cwd and confirm the rows still show under the canonical project.
9. Switch to dark theme and repeat steps 1-4.

#### Expected Results
- A registered symlink root and a session cwd pointing at the symlink target are treated as the same project.
- Sessions recorded through either path form are not filtered out as unregistered workspace roots.
- Duplicate symlink/canonical labels collapse deterministically to the canonical path label.
- Workspace-root writes do not reintroduce symlink/canonical duplicates into persisted state.
- Repeated cwd values in one `thread/list` response reuse the same canonical path result and do not change visible rows.
- Search and sidebar browsing both expose the session.
- Rows remain readable in light and dark themes.

#### Rollback/Cleanup
- None.

---

### Workspace roots store extraction compatibility (9-C-5)

#### Prerequisites/Setup
- Use an isolated `CODEX_HOME` and a server pointed at the usual external app-server fixture.
- Create two temporary directories and a symlink to one. Register both directories through the project UI.
- Add an unrelated sentinel field and an unknown field in a remote-project record to `.codex-global-state.json`.

#### Steps
1. GET `/codex-api/workspace-roots-state`; confirm the existing `{ data: { order, labels, active, projectOrder, remoteProjects } }` envelope.
2. Send concurrent PATCH requests to that endpoint: rename the symlinked root, reorder both roots, and delete the other root. Use `{ type: 'rename', path, label }`, `{ type: 'reorder', order }`, and `{ type: 'delete', path }` bodies.
3. GET the state again and inspect the persisted file. Confirm the rename and deletion both remain, ordering contains only surviving local roots plus remote IDs, and both unknown fields are intact.
4. PUT a legacy state body to the endpoint; confirm HTTP 409 with `Workspace updates have changed. Reload this tab before editing projects.` and no file change.
5. Repeat a no-op rename and confirm the file modification time does not change.
6. With the server idle, temporarily replace the global-state JSON with malformed JSON. GET and PATCH must report errors without replacing the file. Restore the original file and confirm subsequent PATCH succeeds.

#### Expected Results
- Alias and canonical paths retain one identity; canonical labels win collisions.
- Concurrent operations preserve unrelated fields and use the existing global-state transaction.
- GET/PATCH response envelopes and legacy PUT rejection remain unchanged.
- Failed persistence is reported and leaves recoverable state.

#### Rollback/Cleanup
Stop the isolated server, remove its temporary `CODEX_HOME`, directories, and symlink. Do not edit normal user state.
