# Markdown highlight initialization and audit checks

## Prerequisites

Run the current app with an independently managed external app-server. Use a disposable conversation with ordinary Markdown, inline code, 120+ messages, and a completed command containing large output. Open a fresh page for each fence-style case so the highlighter starts unloaded.

## Actions and expected results

1. Stream a message beginning with `~~~js`, a newline and `const n = 1`, leaving the fence open temporarily. Syntax highlighting appears without any earlier backtick message. Close the tilde fence; text and highlighting remain correct.
2. Repeat in a fresh page using triple backticks. Both styles initialize highlighting. Observe the network: one shared lazy highlight module load rather than a new load per update.
3. Where a synthetic stream harness is available, update the same message ID from JavaScript to a Python fence containing `return True`, then close the fence. The language label and highlighting reflect current content without stale JavaScript. Unknown language and unlabelled code remain escaped plain code.
4. Confirm headings, emphasis, inline code containing `<`, links, and code containing HTML-looking text retain their existing output and navigation. Updating unrelated messages must not change completed Markdown.
5. Load the long conversation, follow the bottom while streaming, then scroll up and load earlier messages. Verify order, no viewport jump, and continued access to older history. Known deferred defect: direct mounting with preloaded messages/loading=false can initially expose all candidates; subsequent watched updates enforce 50. This task does not fix that path.
6. Expand/collapse the large command output and command groups. Full output is retained while collapsed; expansion, selection and copy still work. Check following the bottom and reading history during updates.
7. Repeat on desktop, 375x812 and 768x1024 in light and dark themes. Switch threads during streaming/history loading; old state must not affect the new thread.

## Cleanup

Close the disposable thread and any preview. No new persistence is introduced. Remove synthetic fixtures if created; do not modify real project files to generate output.

## Automated checks

Run `pnpm exec vitest run src/components/content/ThreadConversation.test.ts`. Setup-script instrumentation measures parse counts without production instrumentation. See [rendering follow-ups](../../docs/maintenance/open-items.md#history-and-rendering) for current limitations; operation-count tests do not establish browser frame time or heap usage.
