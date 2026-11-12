# ThreadConversation Structural and Performance Audit

> Historical audit: application-managed file Undo/Redo, filesystem restoration during conversation revert, project creation, GitHub cloning, automatic chat directories, camera/folder attachments, and project aliases/manual ordering have since been removed. Native thread operations, existing workspaces, file/image attachments, and diff inspection remain. Earlier implementation details below describe the pre-removal code. Current verification: [workspace workflows](../../tests/projects-sidebar-new-chat/native-workspace-workflows.md).

Phase 9-B audit of `src/components/content/ThreadConversation.vue`, performed 2026-11-10. This is a static code-path review; no files were changed during the original audit and no runtime profiling was performed.

## Responsibilities and approximate size

The component is 5,070 lines: 932 lines of template, roughly 3,000 lines of script, and 1,114 lines of scoped styles. Major script areas are markdown/link parsing and rendering (~1,700 lines; lines 1447–3639), command and plan behavior (~300; 969–1286), copy/fork/edit/file summaries/diff actions (~600; 1697–2292), and scroll/window/watchers (~400; 3641–3953). These areas overlap.

## State and dependency map

`App.vue` supplies messages, active thread, cwd, loading state, pending requests, live overlay, and older-history loading (App.vue:377). Message-derived computeds build command groups, hidden IDs, response anchors, file summaries, and editable turns. Message text feeds block and inline parsing; cwd affects file-link resolution and markdown cache identity; highlighter version affects generated HTML and `v-memo` invalidation. Local state owns expansion, copy feedback, image/diff modals, file action state, and auto-follow. File Undo/Redo calls the API locally; rollback, fork, and implement-plan actions emit to the parent.

The upstream combined message computed in `src/composables/useDesktopState.ts:1540` replaces live message objects during streaming. The component’s messages watcher therefore participates in stream updates. Keep scroll anchoring, rendering-window updates, pagination restoration, and image-settlement coordination centralized until measured and covered together.

## Verified findings and risks

### Verified redundant work

- Anchored and standalone file summary computeds independently scan messages to build assistant anchors and file-change groups (ThreadConversation.vue:1893, 1940). A pure indexing pass could produce both results.
- Plan fallback parsing can repeat within the same render because explanation, steps, copy eligibility, and fallback display call through `readPlanData` (line 1006; template lines 318–347).
- Collapsed command output remains mounted in `<pre>`; CSS condensation changes display but the full `aggregatedOutput` remains attached (template lines 45, 71).
- Highlight loading watches only triple-backtick text (line 3822), while the parser accepts tilde fences too (line 3212). Tilde-only code blocks do not trigger the lazy loader.
- `downloadName` is populated on inline file segments but never consumed; `getBasename` only serves that field. Cache entry text/cwd/version metadata also repeats cache-key data.

### Potential correctness and performance risks

- `renderWindowStart` initializes to zero and initialization watchers are not immediate. A cached mount with populated messages and `isLoading=false` can initially render the whole list before another watched input changes (line 1413). Confirm with a mount-level case.
- Thread-switch cleanup resets some state but leaves diff viewer selection, context menu, failed-image set, and worked expansion IDs intact (line 3872). The diff viewer holds a summary object. Stale state is a risk requiring reproduction.
- Image failure keys use message ID and block index, not URL; replacing an image at the same position may retain the failure state. Plan images rendered via `v-html` do not get template image error/modal handlers.
- The rendering limit is a trailing-message window, not viewport virtualization. It grows when reading history; individual command output and diffs are not size-bounded.
- Streaming changes reparse complete message text and re-highlight changed code blocks. Stable messages benefit from `v-memo` and bounded caches; growing prefixes can accumulate in the entry-bounded highlight cache. Cost and memory are unmeasured.
- Scroll scheduling coalesces message updates, while deep overlay changes separately enforce bottom state and schedule lock frames. Layout cost and redundant writes need a browser trace.
- A pending file action can repopulate cleared action maps after a thread switch. A pending next-tick scroll can schedule work after unmount unless guarded.

Markdown HTML is produced by controlled renderers with escaping and URL/path classification, rather than a general sanitizer. No executable HTML issue was established in this audit. No automatic network fanout was found in rendering; older-history calls are guarded, highlighting shares an in-flight import, and file actions are user initiated. Request counts and payload sizes were not measured.

## Refactoring candidates

| Classification | Boundary | Benefit and dependencies | Regression coverage |
|---|---|---|---|
| High value / low risk | `conversationFileChanges.ts`: pure aggregation, indexing, hidden IDs; action/API state stays in component | Removes duplicate scans; no UI ownership change | Anchor precedence, missing turn IDs, repeated/moved paths, order, hidden IDs, input immutability |
| High value / low risk | `conversationLinks.ts`: path/reference parsing and URL creation with explicit cwd | Isolates complex pure parsing; component retains context menu | Unix/Windows paths, spaces, parentheses, wrappers, line suffixes, deep links, unsupported schemes; TestChat link checks |
| High value / low risk | `conversationPlan.ts`: pure interpretation and copy formatting | Makes fallback parsing testable and enables one derived plan value per message | Structured/fallback plan, statuses, empty content, copy output, implement eligibility |
| High value / medium risk | `ThreadDiffViewer.vue`: summary/selection props and close/select events; parent initially owns selection | Clear boundary for desktop list, mobile sheet, and modal | Numbering, empty state, selection, themes, mobile sheet, thread switching |
| High value / medium risk | `TurnFileChangeSummary.vue` | Removes duplicated anchored/standalone presentation; keep action state/API in parent | Partial failures, disabled actions, Undo/Redo, rollback separation |
| High value / medium risk | Markdown parser/renderer with explicit context and injected highlighter | Test boundary for largest logic area | Vue and HTML rendering, escaping, nested lists, images, scoped styles, cache invalidation |
| High value / medium risk | Command row/group components | Isolates repeated command UI | Active-command expansion and grouping; avoid changing mount/animation behavior without measurement |
| Low value / unnecessary | Components for each inline segment or tiny toolbar; generic cache framework | No demonstrated benefit yet | Avoid absent a concrete reuse or profiling need |
| Should remain centralized | Scroll container, auto-follow, render window, pagination restoration, image-settlement coordination | Shared geometry and scheduling invariants | Test as one behavioral system before extraction |

## Tests and performance verification

Existing coverage includes `src/utils/diffViewerLines.test.ts`, `src/composables/useDesktopState.messages.test.ts`, and manual scenarios for rendering windows, scroll preservation, older history, links, images, copy, rollback, and fork. Vitest currently has no dedicated `ThreadConversation` component suite.

Two manual documents conflict with the implementation: `tests/git-worktrees-rollback/worked-separator-is-non-expandable.md` expects a passive separator while the current template has an expansion button; older steps in `per-turn-changed-files-panel-with-lazy-diff-loading.md` describe per-file lazy fetches while the current viewer uses summary diff content. Resolve expectations before treating these as acceptance tests.

For implementation, use focused utility tests, typecheck, and relevant unit tests. UI extractions need light/dark checks; diff viewer also needs mobile checks. Link changes require TestChat `hrefOk`, `titleOk`, and `textOk` validation. Performance baselines should cover cold/cached thread opens, long streamed prose and code, large collapsed command output, large diffs, reading history during streaming, pagination, rollback shrink, and rapid thread switching. Record request counts, payload sizes, long tasks, frame times, DOM size, heap growth, and scroll stability. The existing browser profiler provides request diagnostics; the realtime helper currently submits a file-generating task and defaults to a machine-specific TestChat path, so adapt it before using it for this audit.

## Recommended sequence

1. Extract pure file-summary indexing with characterization tests.
2. Extract pure link/path utilities, keeping rendering and cache ownership unchanged; run existing link checks and TestChat validation.
3. Extract the diff viewer, keeping selection in the parent initially and adding thread-switch, theme, and mobile regressions.

Before step 3, reproduce and test thread-switch cleanup. Before broader markdown or scroll extraction, address the initial-window initialization risk and establish streaming/scroll baselines. No measured regression currently supports a wholesale reactive-state or virtualization rewrite.
