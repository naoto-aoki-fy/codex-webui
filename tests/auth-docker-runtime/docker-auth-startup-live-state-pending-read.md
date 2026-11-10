### Pending first-turn materialization after live-state retirement

#### Prerequisites/Setup
Use an independently managed, authenticated Codex app-server with matching user, CODEX_HOME and paths; see [external verification](../website-docs-misc/external-app-server.md). Use a disposable new thread. Local-auth Docker matrices are retired.

#### Steps
1. Open the new thread and send `hi`.
2. Inspect normal `/codex-api/rpc` `thread/read` requests during first-turn materialization.
3. If the recognized pending-materialization error occurs, assert empty `turns` and `status.type="inProgress"`, with no visible read error.
4. Wait for normal completion and reload; verify history in light and dark themes.
5. Request `/codex-api/thread-live-state?threadId=<id>` and assert JSON 404.

#### Expected Results
Normal RPC pending-materialization recovery remains; unrelated failures still surface. The retired diagnostic envelope and reconstruction are intentionally unavailable. Generic reads do not reproduce them.

#### Rollback/Cleanup
Archive only the disposable thread. Leave persistent servers and authentication state intact.
