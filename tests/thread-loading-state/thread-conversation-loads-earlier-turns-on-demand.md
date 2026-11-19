### Thread conversation loads earlier turns on demand

#### Feature/Change Name
Thread conversation incremental older-turn loading.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. A thread with more than 10 turns is available
3. Light theme and dark theme both available from the appearance switcher
4. For inline-media regression checks, use a thread with inline images in both its newest and earlier turns.

#### Steps
1. In light theme, open a thread that has more than 10 turns.
2. Confirm the newest messages render first and the conversation shows the Load earlier messages control at the top.
3. Click Load earlier messages once.
4. Confirm an older batch is prepended above the previously first visible turn and the scroll position stays near the same content.
5. Continue clicking Load earlier messages until the control disappears.
6. Confirm the oldest messages in the thread are visible and no duplicate message rows are introduced.
7. Switch to dark theme and repeat steps 1-6 on the same thread or another long thread.
8. For the inline-media sanitization extraction, verify images render in the newest page and after loading earlier turns. Inspect image URLs in developer tools: inline images should use `/codex-app-asset?id=...`. Reload and repeat; confirm non-image message content is unchanged.

#### Expected Results
- Initial thread open remains bounded to the latest turn page.
- Load earlier messages calls native `thread/turns/list` through the bridge with the opaque cursor from the preceding page.
- The control remains available while older persisted turns exist and disappears after the first turn is loaded.
- Message ordering, turn actions, and scroll restoration remain stable in light and dark themes.
- Inline media continues to render in both history views without duplicate history requests. Existing local proxy URLs and attachment fallback text retain their behavior.

#### Rollback/Cleanup
- None.

---

### Concurrent detail refresh and history retirement

Setup: a disposable fixture thread with more than ten turns, plus controllable
pending detail/page responses. Use a cursor from the recent reply and an opaque next cursor or null from the older page.

1. Load recent turns and request an older page. Force a detail refresh while it
   is pending. Complete page then detail, and repeat with detail then page.
2. Expect both ranges to survive in order, stable order by native turn ID, and the
   oldest loaded page's next cursor. Neither loading flag remains stuck.
3. Switch threads during each pending read; no content or error may leak into
   the selected thread. Returning to the original thread retains its history.
4. Archive the source thread while a detail/page read is pending, then settle it.
   Expect no cache resurrection or stale loading/pagination flags.
5. Prune a pending background thread read and start a replacement read for the
   same ID. Settle the old success/failure first; the new read keeps ownership.
6. Stream a live reply during refresh and verify existing reconciliation tests
   still retain it until a matching persisted row arrives.

Automated: `pnpm exec vitest run src/composables/useDesktopState.messages.test.ts`.
Cleanup: dispose fixture states; archive only disposable fixture threads.

Empty-page edge: return an empty older page with `nextCursor: null` before a
pending detail refresh completes. If the detail still contains the page boundary,
the refresh must keep pagination exhausted rather than re-enable the older button.

## Bottom-follow scrolling with optional composer controls

Setup: an idle short history with an unloaded older page; use the conversation-
tools fixture at desktop, phone and tablet sizes. Open the conversation and allow
its normal bottom-follow scroll to settle. Expanding/collapsing optional composer
controls or resizing while following the bottom must not fetch an older page.
Scroll upward away from the bottom, or explicitly click Load earlier messages:
the normal pager must still fetch and preserve position. Fixture cleanup: close
browser; no live history mutation. `conversationViewport.test.ts` reproduces the
near-top/at-bottom overlap. Performance: one extra boolean guard on the existing
scroll handler; no listener, cache, history request or polling added.
