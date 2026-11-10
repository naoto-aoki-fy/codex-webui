# Legacy API and Optional Feature Audit

This began as a static repository audit; endpoint status below reflects the subsequent authorized fallback and live-state retirements. Repository searches do not establish whether independently maintained external clients use an endpoint, and production traffic was not measured.

## Part A: Legacy HTTP endpoints

The remaining handlers and explicit retirement responses are in `src/server/codexAppServerBridge.ts`. No current frontend caller was found for any of them.

| Endpoint | Repository evidence | Backend boundary and recommendation |
|---|---|---|
| `/codex-api/thread-file-change-fallback` | Retired by explicit compatibility-breaking decision; external use was not established absent. | Returns HTTP 404 JSON, with no replacement. Exclusive builder/type/merge helpers removed; shared parsing and rollback remain. |
| `/codex-api/thread-live-state` | Retired by explicit authorization; all methods return JSON 404 without RPC. | Exclusive response reconstruction, live-state cache and captured-item cache removed. Normal history, earlier-page caches, snapshots, materialization handling, timestamps, generation metadata, skills and inline payload recovery remain. No replacement for diagnostic command/file-change reconstruction. |
| `/codex-api/thread-stream-events` | No frontend caller. Manual stream-parity tests query it directly during active turns. | The HTTP adapter is route-specific. `getStreamEvents`, event buffering and `mergeStreamTurnErrorsIntoThreadResult` also support normal thread history/error recovery. Retain shared stream recovery; investigate external use before retiring route. |

Relevant tests include `tests/thread-loading-state/thread-stream-parity-stream-first-hydration-with-full-turn-history.md`, `thread-stream-parity-works-on-linux-oracle-a1-arm64.md`, and `thread-detail-load-avoids-duplicate-live-state-history-fetch.md`. The latter shows normal detail loading avoids a redundant live-state history fetch. The external-server fixture checks both retired paths in built and development servers. Repository silence is not evidence that external clients do not depend on them.

The fallback and live-state response builders and their exclusive implementations are removed. The stream-events response adapter remains supported. Shared code to retain includes stream event buffering/error merging, thread-read snapshots and pending-materialization recovery, session timestamp/generation metadata, and `parseApplyPatchInput` where used by retained recovery and file actions.

## Part B: Optional features

| Feature | Classification | Complexity | Functionality lost if removed |
|---|---|---|---|
| Telegram completion notifications | Optional feature requiring product decision | Medium–high | Completion alerts, test messages, status and retrying queued deliveries |
| Git clone | Optional feature requiring product decision | Medium | In-app GitHub repository cloning |
| Worktree creation | Optional feature requiring product decision | Medium–high | Automated detached and named permanent worktree creation |
| File-change Undo/Redo | Optional feature requiring product decision; backend is active shared functionality | High | Per-turn file reversal/reapplication; conversation rollback currently calls the file-revert service |
| Browser-based file editing | Optional feature requiring product decision | Medium | Editing and saving text files through browser UI |

### Telegram

Frontend: Settings UI/state and polling in `src/App.vue`, API wrappers in `src/api/codexGateway.ts`, theme rules in `src/style.css`. Backend: Telegram routes and lifecycle/config wiring in `src/server/codexAppServerBridge.ts`; delivery, persistent queue and networking in `src/server/telegramNotificationService.ts`, `telegramNotificationOutbox.ts`, and `telegramNetwork.ts`. Runtime dependencies include Telegram HTTPS API, filesystem config/outbox, `undici`, and `proper-lockfile`; `undici` appears Telegram-only, while `proper-lockfile` is also used by global state and thread indexing. Tests: `telegramConfig.test.ts`, `telegramNotificationService.test.ts`, `telegramNotificationOutbox.test.ts`, `telegramNetwork.test.ts`. Docs: `docs/usage.md` and `tests/skills-plugins-integrations/`.

The subsystem has a fairly clear boundary, though persisted config/outbox files should be considered in any removal plan. Removing it could also allow dropping `undici` after a full dependency-use check.

### Git clone and worktree creation

Frontend: create/clone modal and worktree controls in `src/App.vue`; permanent worktree action in `src/components/sidebar/SidebarThreadTree.vue`; wrappers in `src/api/codexGateway.ts`. Backend: `/codex-api/github-clone`, `/codex-api/worktree/create`, `/codex-api/worktree/create-permanent`, and `/codex-api/worktree/branches` in `src/server/codexAppServerBridge.ts`. Runtime: system Git, filesystem operations and workspace-root persistence; no dedicated package dependency.

Manual coverage is in `tests/projects-sidebar-new-chat/unified-create-project-and-github-clone-modal.md` and multiple files under `tests/git-worktrees-rollback/`, covering creation, persistence, branch selection and empty repositories. Clone is narrower to remove; worktree creation has more UI and cleanup logic. Preserve workspace-root persistence and existing worktree/project handling if creation controls are removed.

### File-change Undo/Redo

Frontend action rows and local action state are in `src/components/content/ThreadConversation.vue`; wrapper in `src/api/codexGateway.ts`; backend route `/codex-api/thread/rollback-files` and patch/file operations in `src/server/codexAppServerBridge.ts`. Runtime uses session logs, filesystem and Git for tracked command-modified files; no dedicated package dependency. Manual cases are in `tests/git-worktrees-rollback/rollback-undoes-apply-patch-file-changes.md` and related rollback docs.

This is active shared functionality: `src/composables/useDesktopState.ts` invokes `revertThreadFileChanges` during conversation rollback. Removing the chat buttons alone does not make backend logic removable. First decide whether conversation rollback should continue restoring files. Keep patch parsing and changed-file history logic where still needed.

### Browser-based file editing

Browser editing has been removed after caller revalidation: the conversation action, directory edit links, standalone editor, and GET/HEAD/PUT handlers are retired. Read-only browsing, images, downloads, directory selection, shared HTTP/path validation, and other application filesystem operations remain. See `tests/website-docs-misc/shared-local-file-http.md` for the current contract.

Caller checks confirmed the text eligibility helpers were editor-only and they were removed.

## Prioritized recommendations

1. The file-change fallback and live-state endpoints are retired by explicit decision. Before retiring the remaining stream-events endpoint, seek external-client and access-log evidence and choose a deprecation policy. External use remains unknown.
2. Telegram is the clearest optional subsystem to evaluate first: it has a coherent boundary and is the only apparent consumer of `undici`.
3. Browser editing is retired; preserve browsing and file-link behavior in future cleanup.
4. Evaluate clone and worktree creation separately. Preserve support for already-existing worktrees and shared workspace-root state.
5. Treat Undo/Redo backend removal as the riskiest feature decision because conversation rollback uses the same service.
6. Retain shared thread recovery code: stream error buffers, snapshots, pending-materialization handling, timestamp/generation recovery and shared patch parsing.

The remaining stream-events endpoint is not established as safe dead code. No production usage, performance profile, or external-client inventory was available for this static audit. The live-state retirement performance assessment is documented in [API wrapper cleanup](api-wrapper-cleanup.md).
