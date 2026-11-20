# Ctrl+Arrow message navigation

## Prerequisites

- Open a thread with alternating user messages and assistant replies, including a long reply, command rows, and more than 50 messages for pagination.
- Repeat at 1280 × 900, 768 × 1024, and 375 × 812 in light and dark themes.

## Actions and expected results

1. Scroll into the middle of a long reply. Press Ctrl+ArrowUp. The nearest preceding user/assistant message start aligns with the conversation viewport top.
2. Press Ctrl+ArrowUp repeatedly, then Ctrl+ArrowDown. Move through each user message and assistant reply in order; skip system, command, and file-change rows.
3. Focus the composer and repeat. Navigation works without changing input text or focus. Open a composer suggestion menu: its arrow handling retains priority.
4. Reach the final short messages and reverse direction. Each message remains reachable even when the scroll position is clamped at the bottom. At either boundary, navigation does not wrap.
5. Scroll manually with a wheel, touch, or scrollbar, then navigate again. Navigation starts from the current viewport position.
6. Press unmodified arrows, Ctrl+Shift+arrows, and Alt+arrows. Existing behavior is preserved. With a modal dialog open, Ctrl+arrows do not navigate the underlying conversation.
7. While reading older messages, let a reply stream. Navigation does not force the viewport back to the latest output. Click the existing jump-to-latest button to resume following output.

Scrolling near the beginning of the conversation can automatically fetch earlier history before you press **Ctrl+↑**. Use the automated regression test below to control when the request starts and when each response arrives.

## Automated regression testing

With Playwright Chromium installed, start the development server from the repository root.

```bash
pnpm run dev --host 127.0.0.1 --port 4173
```

Leave the server running and open another terminal at the repository root.

```bash
node scripts/test-plan-mode-question-panel.cjs
```

The Playwright fixture suppresses the setup scroll event while positioning the conversation at the beginning. It then presses **Ctrl+↑** to start the `thread/turns/list` request and controls when the response is released. The script should report `PASS` in both themes at all three viewport sizes.

1. **Question jump during history loading.** Click **Jump to question** while **Loading…** is shown, then release the history response. The question moves to its turn, the entire **Awaiting response** heading remains visible and keyboard-focused, and the shortcut accounts for the only history request.
2. **Uninterrupted navigation.** Let the **Ctrl+↑** history response arrive without intervening actions. The previous message aligns with the top of the conversation viewport. Press **Ctrl+↑** again to align the preceding message. Only one history request is made.
3. **Thread switching.** Start a **Ctrl+↑** history request in the first thread, switch to a second thread, and start its request with the same shortcut. Release the first response while the second is pending. The second thread stays at the top until its own history arrives, then aligns its previous message with the top of the viewport. Each thread makes one history request.

## Cleanup

Return the manual test thread to the latest output. The automated script closes its browser when it finishes.

## Performance audit

Navigation queries rendered direct message rows on a matching keypress. The pending-operation token adds a constant-time check when loading finishes. Pagination retains its existing page size and request handling. The browser fixture checks that the question jump issues zero extra history requests and that overlapping loads in separate threads each issue one request.
