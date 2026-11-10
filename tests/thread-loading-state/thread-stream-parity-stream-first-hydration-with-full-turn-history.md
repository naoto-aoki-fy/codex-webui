### Thread detail paging and retired diagnostics

#### Prerequisites/Setup
- Start an independent Codex server and this app with matching user, CODEX_HOME and paths.
- Use a thread with more than 10 turns, including commands and file edits.
- Open browser Network tools; repeat UI checks in light and dark themes.

#### Steps
1. Open the long thread and inspect the `thread/read` RPC with `includeTurns: true`.
2. Confirm the bridge returns the latest 10 turns and older-history metadata.
3. Click Load earlier messages; inspect `/codex-api/thread-turn-page` and continue to the oldest turn.
4. Confirm no duplicate rows and stable chronological order and scroll position.
5. Separately fetch `/codex-api/thread-live-state?threadId=<id>` and assert HTTP 404 with JSON `{"error":"Not found"}`.
6. Inspect `/codex-api/thread-stream-events?threadId=<id>&limit=50` during an active turn.
7. Check a completed session with recoverable command/file-change items and an active session.

#### Expected Results
- Frontend detail loading uses bounded `thread/read`, with older pages on demand.
- The retired live-state endpoint returns JSON 404; normal RPC history is not a replacement for its removed diagnostic reconstruction.
- Stream events return `{ events: [...] }`; active commands retain turn scoping.
- Upstream-provided command/file-change items remain visible; session-log reconstruction exclusive to the retired endpoint is no longer expected.
- Loading earlier history preserves message ordering and avoids duplicate rows.

#### Rollback/Cleanup
- Close diagnostic tools and restore the previous theme. Do not revert commits or delete sessions.

The filename preserves links to the former stream-first acceptance procedure;
its first-request and fallback expectations have been superseded by paged detail loading.
