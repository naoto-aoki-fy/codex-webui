> Historical structural audit; removed-feature descriptions are superseded by [current capability ownership](native-capability-consolidation.md).

> Historical audit: Telegram integration has since been removed. References below describe the earlier implementation, not current behavior.

# App.vue structural audit after component extractions

This audit reviews `src/App.vue` after the `ProjectSetupModal` (`28b475c`), `FolderPickerModal` (`a947f92`), and `GeneralPreferencesSettings` (`f792c21`) extractions. It is a static analysis; no code was changed or runtime profiling performed.

## Decision

Continue with a few targeted extractions from `App.vue`, then move to `ThreadConversation.vue`. App.vue is 2,922 lines (about 435 template, 2,100 script, and 377 styles). Its remaining coordination is substantial, but broad extraction of the shell, settings container, or home screen would mostly relocate coupling. `ThreadConversation.vue` is 5,070 lines and has a compact public interface, making it the stronger next large-file target after bounded App.vue work.

## Responsibilities and dependencies

| Area | Approximate size | Main dependencies |
|---|---:|---|
| Settings, preferences, account and context display | 400–500 lines | localStorage, document theme, shared thread/account state |
| Telegram settings | 240–300 lines including styles | Drafts, validation, API calls and status polling; largely independent |
| Project and folder management | 600–750 lines | Filesystem APIs, workspace roots, project ordering and selected cwd |
| New-thread runtime and branches | 200–300 lines | Git status, branch requests, worktree creation and first-message submission |
| Thread startup and navigation | 150–220 lines | Router, shared selection, loading and polling |
| Sidebar/search, viewport and conversation wiring | Remaining shell code | DOM lifecycle, scroll restoration, mobile keyboard and child refs |

The major boundaries are visible in the settings template at `src/App.vue:82`, project/folder state at `:675`, and initialization/routing at `:2209`. Existing components already own presentation for general preferences, account settings, sidebar tree, composer, conversation, project setup and folder picking. `useDesktopState` owns shared thread/model/project operations; `useUiLanguage` owns language persistence.

## Verified issues and risks

- **Duplicate branch requests:** the runtime/cwd watcher at `src/App.vue:2357` and runtime watcher at `:2366` both invoke `loadWorktreeBranches` when runtime changes to `worktree`. `getWorktreeBranchOptions` at `src/api/codexGateway.ts:1220` fetches on each invocation.
- **Stale branch results:** `loadWorktreeBranches` at `src/App.vue:2490` applies results without checking that the requested cwd is still current. An older response can overwrite options for a newer folder; this consequence is a risk inferred from the code, not a reproduced failure.
- **Telegram polling remains active after settings close:** `toggleTelegramConfig` at `src/App.vue:1135` starts a 10-second interval. Escape/outside-click handlers at `:1526` close the settings panel without clearing the timer or changing `isTelegramConfigOpen`. Slow polling can also overlap because there is no in-flight guard.
- **Project suggestions can be requested repeatedly:** `refreshDefaultProjectName` at `src/App.vue:1879` is called explicitly after project actions and by watchers at `:2310` and `:2330`; requests have no response-order guard. Duplicate calls and stale suggestion updates are plausible; request counts were not measured.
- **Selected-folder validation is ineffective:** `newThreadFolderOptions` at `src/App.vue:879` inserts the selected cwd if absent, so the watcher at `:2310` cannot detect that the selected root disappeared. Whether preserving that selection is intended needs product-level confirmation before changing behavior.
- **Unused references:** `selectedModelId` is destructured at `src/App.vue:545` but not used; `settingsAreaRef` is assigned at `:626` but never read.

Workspace roots have multiple callers in App and `useDesktopState`, but the gateway cache/coalescing at `src/api/codexGateway.ts:1098` means multiple callers do not prove duplicate HTTP requests. Separate reactive copies are a potential synchronization concern, not a verified defect.

## Refactor candidates

| Candidate | Classification | Boundary, ownership and benefit | Main regression risks and relevant tests |
|---|---|---|---|
| Telegram settings | High value / low risk | Extract `TelegramSettings` and a focused controller/composable owning drafts, validation, status, save/test state and polling. Parent supplies visibility/activity. Removes an independent integration lifecycle. | Preserve drafts and save/test sequencing; test polling cleanup, overlap and settings visibility. See `tests/skills-plugins-integrations/telegram-notification-test-and-status.md` and existing server Telegram tests; verify both themes. |
| Folder-picker behavior | High value / medium risk | `useFolderPicker` owns listing, filtering, nested folder creation, errors and request generation. App retains confirmed-path project registration and navigation. | Preserve close invalidation, late-response protection, hidden-folder reload and focus behavior. Use existing folder-picker/project manual cases and add focused late-response tests. |
| New-thread runtime | High value / medium risk | `useNewThreadRuntime` owns runtime, branches, loading and worktree status, taking cwd/Git eligibility as input. App retains first-message submission and routing. | Preserve local-worktree fallback and submission ordering. Cover branch selector, non-Git folders, worktree persistence and projectless chat cases under `tests/git-worktrees-rollback/` and `tests/projects-sidebar-new-chat/`. |
| Preference persistence/theme | Low value / unnecessary now | A small composable is possible, but current ownership is understandable. Keep the preferences component presentational. | Avoid unnecessary synchronization between component and persisted state. |
| Whole settings container or home-screen wrapper | Low value / unnecessary | Would move account, context, Telegram, composer bindings and modal coordination into another coordinator with many props/events. | Increased wiring and state synchronization without clear ownership gain. |
| Thread Markdown export | Low value / optional | `buildThreadMarkdown` at `src/App.vue:2065` could become a pure utility. | Small isolated cleanup, lower priority than lifecycle boundaries. |
| Route/selection synchronization | Should remain centralized | Startup, route changes, selection priming, pending synchronization and recovery form one coordinated state machine at `src/App.vue:2209`. | Splitting watchers risks route/selection races and startup regressions. Existing thread loading and rapid-switch cases are relevant. |
| Account/model integration | Should remain centralized | Existing account and composer components own presentation; shared state owns model preferences. Keep busy guards and refresh orchestration in App. | Preserve authentication refresh/logout guards and selected-thread model behavior. |
| Cross-dialog project completion | Should remain centralized | Keep selected cwd, project pinning, roots refresh and navigation together. | Splitting completion flow risks partial project state or navigation. |

## Prioritized next tasks

1. Consolidate branch loading and add request-order protection, preferably in `useNewThreadRuntime`; remove the duplicate request first.
2. Extract Telegram settings with explicit draft ownership, stop polling while inactive, and guard overlapping status requests.
3. Extract folder-picker behavior while leaving project registration/navigation in App; separately reconcile project-suggestion refresh triggers.

After these bounded changes, prioritize `src/components/content/ThreadConversation.vue`. Its 5,070 lines combine Markdown parsing/rendering, diff interactions, command grouping, caches and scrolling behind a relatively compact component interface.
