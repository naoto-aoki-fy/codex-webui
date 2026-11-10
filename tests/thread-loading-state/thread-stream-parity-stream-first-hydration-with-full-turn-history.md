### Thread detail paging and full-history diagnostics

#### Prerequisites/Setup
- Start an independent Codex server and this app with matching user, CODEX_HOME and paths.
- Use a thread with more than 10 turns, including commands and file edits.
- Open browser Network tools; repeat UI checks in light and dark themes.

#### Steps
1. Open the long thread and inspect the `thread/read` RPC with `includeTurns: true`.
2. Confirm the bridge returns the latest 10 turns and older-history metadata.
3. Click Load earlier messages; inspect `/codex-api/thread-turn-page` and continue to the oldest turn.
4. Confirm no duplicate rows and stable chronological order and scroll position.
5. Separately fetch `/codex-api/thread-live-state?threadId=<id>` and inspect `conversationState.turns`.
6. Inspect `/codex-api/thread-stream-events?threadId=<id>&limit=50` during an active turn.
7. Check a completed session with recoverable command/file-change items and an active session.

#### Expected Results
- Frontend detail loading uses bounded `thread/read`, with older pages on demand.
- The retained live-state endpoint returns full available recovered history; it is
  not the primary frontend request or a prerequisite for initial rendering.
- Stream events return `{ events: [...] }`; active commands retain turn scoping.
- Recovered command/file-change items preserve chronological ordering where the
  session log contains them. Assistant prose is not heuristically converted into file changes.
- Loading earlier history preserves message ordering and avoids duplicate rows.

#### Rollback/Cleanup
- Close diagnostic tools and restore the previous theme. Do not revert commits or delete sessions.

The filename preserves links to the former stream-first acceptance procedure;
its first-request and fallback expectations have been superseded by paged detail loading.
