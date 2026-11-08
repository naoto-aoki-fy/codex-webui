# Incremental frontend responsibility extraction

## Current boundaries

- `src/App.vue` is the application composition root: route and thread selection, desktop layout, dialogs and settings (including account and Telegram), project creation, and application-level event/lifecycle wiring.
- `src/composables/useDesktopState.ts` owns shared reactive state: project/thread lists and filtering, model/configuration preferences, local persistence, optimistic messages, history hydration/recovery, and live notification reconciliation. These operations share caches and request coordination; separating them requires preserving ownership and cancellation.
- `src/components/content/ThreadConversation.vue` owns conversation presentation: message/markdown rendering and highlighting caches, command groups, file-change summaries and diff modal, copy/edit/fork interactions, image handling, render windowing, and scroll-follow behavior.

## First extraction: diff viewer line parsing

`src/utils/diffViewerLines.ts` converts a `UiFileChange` into display rows with stable keys, row kinds, and old/new line numbers. It handles unified updates and synthetic add/delete/raw-content rows. The file-change key helper moves with it so selection and row identity use the same definition.

The parser has no Vue, DOM, network, persistence, or lifecycle dependencies. Its implementation is moved unchanged. The component retains its computed evaluation, diff selection, modal, language inference, markers, templates, and styles. Streaming, attachments, history, and scroll ownership are untouched.

Regression tests cover headers, multiple hunks, context/add/remove numbering, metadata, zero-count hunks, CRLF, blank lines, synthetic fallbacks, move identity, empty input, and repeatable output without input mutation. See `src/utils/diffViewerLines.test.ts`.

## Performance audit

Concrete code-path review: parsing retains the same normalization, splitting, single traversal, and output allocation (linear in diff length). No extra parser call, watcher, subscription, request, fanout, cache, invalidation, or blocking I/O is introduced. The existing computed remains the sole parser caller in the component. Production build succeeds; the conversation JS chunk is 71.07 kB (20.28 kB gzip). No before/after browser latency measurements were taken; this extraction changes no UI or lifecycle behavior.

## Separate follow-up

Extract command-output presentation into a self-contained component, starting with static status/label rendering. Keep command grouping and expansion ownership in the conversation until their input/event contract is tested. This can reduce template responsibility without touching history hydration or scroll coordination.

## Verification results

- `pnpm exec vitest run src/utils/diffViewerLines.test.ts`: 7 tests passed.
- `pnpm run build`: frontend typecheck, Vite production build, and CLI build passed.
- Full unit suite: 328 passed, 1 failed. The optimistic-thread completion test in `useDesktopState.test.ts` duplicates `user:hi`; the same failure reproduces with the original `HEAD` conversation component restored temporarily. It is outside this extraction.
- Source comparison confirms the extracted parser and file-change key implementations match `HEAD` exactly (apart from exports).
- Browser/theme checks were not run; templates and styles are unchanged. Manual checks are documented in `tests/git-worktrees-rollback/per-turn-changed-files-panel-with-lazy-diff-loading.md`.
