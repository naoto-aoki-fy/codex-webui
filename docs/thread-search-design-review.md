# Native conversation search

Conversation content search uses the experimental Codex app-server `thread/search`
RPC. Codex 0.167.2 was verified against an independently managed server at
`ws://127.0.0.1:4500`. Earlier versions are not certified; method availability,
rather than a guessed minimum version, is the compatibility boundary. Unsupported
servers show an explicit error in the **Messages** results. The **Thread Name**,
**Project**, and **Folder** targets match sidebar metadata.

## Authoritative protocol and implementation

Reviewed upstream commit `c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee`:

- [Protocol parameters and responses](https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/app-server-protocol/src/protocol/v2/thread.rs): `ThreadSearchParams`, `ThreadSearchResult`, `ThreadSearchResponse`.
- [Experimental method registration](https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/app-server-protocol/src/protocol/common.rs).
- [Request handling](https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/app-server/src/request_processors/thread_processor.rs): `thread_search_response_inner`.
- [Store search and scope](https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/thread-store/src/local/search_threads.rs).
- [Content matching](https://github.com/openai/codex/blob/c0cc9fc820f62e4dbdde68214dd6d792d6c8a7ee/codex-rs/rollout/src/search.rs): `conversation_text_from_item` accepts user and assistant messages, including their event representations; matching is a case-insensitive literal substring.

Initialization already sends `capabilities: { experimentalApi: true }` in
`appServerWebSocketClient.ts`; the transport test now explicitly asserts it.
The gateway sends `searchTerm`, `archived: false`, `sortKey: updated_at`,
`sortDirection: desc`, `limit: 100`, and an opaque `cursor`. Responses contain
`data: [{ thread, snippet }]`, `nextCursor`, and `backwardsCursor`. Search
publishes each page, requests the next cursor sequentially, and reports repeated
cursors as an error. Changing the query or target or closing search cancels the
browser request and stops pagination for that search.

Source filtering remains the native interactive-source default, matching the old
scanner's `thread/list` default. Attached threads remain excluded; account filtering
remains the server's default (`currentAccountOnly: false`), as in the previous
implementation. No cross-account aggregation or filesystem index is introduced.
Search metadata hydrates previously unloaded sidebar rows without reading history.
Both legacy `cwd` and newer `environments[].cwd` shapes are accepted.

## Differences and limits

The removed scanner paged all metadata, but read user/assistant messages and command
strings/output for only the newest 100 conversations. It cached the result for five
minutes with mutation/notification invalidation and matched lowercase substrings.
Native search covers older persisted conversation bodies too, and returns fresh
results on each query. It searches persisted data; visibility of an in-flight
message depends on Codex persistence. Snippets are currently unused.

**Messages** uses native user and assistant text matching. Command output and
matches across message boundaries are outside that scope. Unicode case folding
can differ from JavaScript `toLowerCase`.

Search displays a single list. **Messages** uses native updated-at descending
order. **Thread Name** searches displayed titles and **Folder** searches path
leaves. Both reuse the sidebar's cursor for older thread metadata and pause
pagination while a response is generating. **Project** includes registered
Projects without threads. See the [sidebar search procedure](../tests/thread-loading-state/thread-search-freshness.md)
for navigation, ranking, and request checks.

## Original native search verification and performance

Real Codex 0.167.2, read-only probes against existing history: 195 threads listed;
user, assistant, body-only, Japanese, and a thread beyond position 100 matched.
For `the`, a 100-result page and successive one-result pages agreed on order and
had distinct IDs. A unique nonsense query returned zero results. A separate
connection without the experimental capability was rejected with
`thread/search requires experimentalApi capability`. No turns or threads were
created by these probes.

The old cold path required ceil(N/100) list calls plus min(N,100) full history
reads, in four-wide batches. The new path requires ceil(matches/100) search RPCs
(subject to server page sizes), zero search-specific list/history reads, no
notification subscription, and no invalidation state. Pages are sequential;
there is no unbounded request fanout. Memory and payload size scale with returned
thread metadata, not complete conversation histories. Upstream may scan rollouts
again per page; there is no claim of improved server CPU or latency. Full-result
retrieval can be expensive for broad queries; live CPU/heap profiling was not run.

Automated validation: full unit suite (78 files, 1,194 tests), typecheck,
production build, external-server WebSocket/Unix fixture, and public CLI CommonJS
launcher smoke passed. The CLI is ESM; the smoke command was:

```sh
node -e "const {execFileSync}=require('node:child_process'); const h=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'}); if(!h.includes('--port')) throw Error('Missing --port'); console.log('CLI smoke passed')"
```

Playwright was used because Browser Use was unavailable. At
`http://127.0.0.1:4173`, viewport 1280x900, both light/dark checks asserted native
results, one search RPC and zero history reads before selection, and navigation
to a returned thread ID. Screenshots: `output/playwright/native-search-light.png`
and `output/playwright/native-search-dark.png`. The current gateway module was
served by Vite and exercised against the real external server; listener process
cwd inspection was unavailable from the sandbox's process namespace. The server
was reused and left running. No persistent server on port 5173 was modified.
The browser also verified a real no-match query and an intercepted unsupported-API
response: zero result rows for the former and a visible actionable alert for the
latter. Missing-capability rejection was independently checked against real Codex.
