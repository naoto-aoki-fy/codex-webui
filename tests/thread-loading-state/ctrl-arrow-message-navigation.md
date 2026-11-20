# Ctrl+Arrow message navigation

## Prerequisites

- Open a thread with alternating user messages and assistant replies, including a long reply, command rows, and more than 50 messages for pagination.
- For the pending-question case, use the [delayed-history Plan Mode fixture](../theme-layout-terminal/plan-mode-question-panel.md#jump-to-question-while-earlier-history-loads) with `HISTORY_DELAY_MS=30000`. In the browser Network panel, inspect the `/codex-api/` RPCs for `thread/turns/list`.
- Repeat at 1280 × 900, 768 × 1024, and 375 × 812 in light and dark themes.

## Actions and expected results

1. Scroll into the middle of a long reply. Press Ctrl+ArrowUp. The nearest preceding user/assistant message start aligns with the conversation viewport top.
2. Press Ctrl+ArrowUp repeatedly, then Ctrl+ArrowDown. Move through each user message and assistant reply in order; skip system, command, and file-change rows.
3. Focus the composer and repeat. Navigation works without changing input text or focus. Open a composer suggestion menu: its arrow handling retains priority.
4. Reach the final short messages and reverse direction. Each message remains reachable even when the scroll position is clamped at the bottom. At either boundary, navigation does not wrap.
5. Scroll manually with a wheel, touch, or scrollbar, then navigate again. Navigation starts from the current viewport position.
6. Press Ctrl+ArrowUp from the start of the conversation to load earlier messages. Let the response arrive without intervening actions. The previous message aligns with the top of the conversation viewport. Press Ctrl+ArrowUp again to move to the preceding message.
7. In the delayed-history fixture, use Ctrl+ArrowUp from the beginning to load earlier messages. Click **Jump to question** while **Loading…** is shown. When the history arrives, the question moves to its turn. Verify that all of **Awaiting response** is visible, the heading still has keyboard focus, and the Network panel shows only the initial history request.
8. With a delayed history request running in one thread, switch to a second thread that also has earlier history. Press Ctrl+ArrowUp from its beginning while the first request is pending. Let the first request finish before the second. The second thread stays in place until its own history arrives, then moves to its previous message. The Network panel shows one history request per thread.
9. Press unmodified arrows, Ctrl+Shift+arrows, and Alt+arrows. Existing behavior is preserved. With a modal dialog open, Ctrl+arrows do not navigate the underlying conversation.
10. While reading older messages, let a reply stream. Navigation does not force the viewport back to the latest output. Click the existing jump-to-latest button to resume following output.

Run `node scripts/test-plan-mode-question-panel.cjs` against the fixture development server to exercise the delayed-response cases with controlled response ordering.

## Cleanup

Close the fixture browser or return the test thread to the latest output.

## Performance audit

Navigation queries rendered direct message rows on a matching keypress. The pending-operation token adds a constant-time check when loading finishes. Pagination retains its existing page size and request handling. The browser fixture checks that the question jump issues zero extra history requests and that overlapping loads in separate threads each issue one request.
