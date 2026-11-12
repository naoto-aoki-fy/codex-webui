# Ctrl+Arrow message navigation

## Prerequisites

- Open a thread with alternating user messages and assistant replies, including a long reply, command rows, and more than 50 messages for pagination.
- Repeat in light and dark themes.

## Actions and expected results

1. Scroll into the middle of a long reply. Press Ctrl+ArrowUp. The nearest preceding user/assistant message start aligns with the conversation viewport top.
2. Press Ctrl+ArrowUp repeatedly, then Ctrl+ArrowDown. Move through each user message and assistant reply in order; skip system, command, and file-change rows.
3. Focus the composer and repeat. Navigation works without changing input text or focus. Open a composer suggestion menu: its arrow handling retains priority.
4. Reach the final short messages and reverse direction. Each message remains reachable even when the scroll position is clamped at the bottom. At either boundary, navigation does not wrap.
5. Scroll manually with a wheel, touch, or scrollbar, then navigate again. Navigation starts from the current viewport position.
6. Navigate upward past the rendered history boundary. Earlier messages load via existing pagination; subsequent presses continue into them. Switch threads during loading: no scroll is applied to the newly selected thread.
7. Press unmodified arrows, Ctrl+Shift+arrows, and Alt+arrows. Existing behavior is preserved. With a modal dialog open, Ctrl+arrows do not navigate the underlying conversation.
8. While reading older messages, let a reply stream. Navigation does not force the viewport back to the latest output. Click the existing jump-to-latest button to resume following output.

## Cleanup

No persisted settings change. Close the test thread or return to the latest output.

## Performance audit

Navigation queries only rendered direct message rows on a matching keypress. It adds no work to rendering or ordinary scroll events, no cache, and no background requests. At an older-history boundary, one existing paginated load is attempted per keypress; concurrent keyboard loads are suppressed. Live browser timings were not measured.
