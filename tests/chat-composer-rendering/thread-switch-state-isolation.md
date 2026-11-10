# Thread-switch UI state isolation

## Scope and state ownership

- Diff summary/selection, diff file-list visibility, file-link menu/target, image preview/failures, command/worked/file-summary expansion, copy feedback, and file-action pending/results belong to the current thread visit. Identity changes discard them, including A → B → A.
- Same-thread message replacement/streaming preserves these choices, subject to existing command/summary ID pruning. Image failures belong to a message/block/URL, so replacing a failed URL retries rendering.
- Earlier-history loading retains scroll restoration within the same visit. Old completions cannot restore scroll or clear a newer loading operation. Queued nextTick/frame/image-settled callbacks cannot act on another visit; canceled scroll promises settle.
- Parent-owned rollback, fork, navigation, persisted history, and file operations remain unchanged. Invalidating UI results does not cancel a filesystem operation already submitted.
- Shared highlight loading and bounded render caches remain reusable. No message scan or deep watcher was added. Existing windowing and post-render thread scroll initialization remain in place.

## Manual verification

Prerequisites: run the app with two fixture or live threads A/B, a completed file-change turn, commands/worked rows, a file link, and an assistant Markdown image. Use both light and dark themes.

1. In A, open a diff and its file list; switch to B. Expect the viewer and selection to close. Return to A; expect no stale viewer.
2. Open a file-link context menu in A; switch to B. Expect the menu to close and its old target to be discarded.
3. Expand command/worked/file-summary rows in A; stream more content in A. Expect choices to persist. Switch to B with colliding message IDs; expect no inherited expansion.
4. Fail an image request; expect Markdown fallback. Replace the URL at the same message/block position with a working image; expect an image retry. Switch threads; expect failure state to reset.
5. Delay an Undo or Redo response; switch A → B → A before releasing it. Repeat with an error response. Expect no old pending/result/error/patch IDs in the new visit. Without switching, Undo then Redo must retain patch IDs and normal status labels.
6. Delay earlier-history loading; switch A → B → A and start a new load. Release the old load first. Expect no scroll restoration or loading-indicator changes from it. Release the current load; expect normal scroll anchoring.
7. Scroll up, load earlier messages, stream output, and use Jump to latest. Expect normal bounded rendering, anchor preservation, and auto-follow. Edit a user message; expect the usual parent rollback flow.

Cleanup: restore network interception and image URLs; redo any test file Undo operations, close previews, and remove disposable test threads if created.

## Automated coverage and performance audit

`src/components/content/ThreadConversation.test.ts` executes the component's actual setup script with Vue reactivity and controlled async/frame boundaries. It covers state dismissal, URL failure identity, success/error invalidation across rapid switching, canceled scroll work, history loading overlap, streaming preservation, parent rollback emission, and normal Undo/Redo patch IDs. It does not mount the DOM or establish live Codex behavior.

Code-path audit: one synchronous scalar identity watcher adds constant work per switch and replaces state containers without scanning messages. Generations are constant-time completion checks. Existing scroll scheduling remains coalesced; cancellation resolves waiting promises and prevents old finalizers from clearing a newer scheduled job. No requests, large payloads, blocking work, or unbounded fanout are added. Render cache bounds and memoization dependencies remain intact; failure version changes only on failure/reset. No runtime speed improvement is claimed; live browser timing and theme appearance were not measured.
