# Native Codex cleanup

## Read receipts
The browser uses `thread/list.readStates` and `thread/read.readState`.
It marks a selected thread read with `thread/readState/update`, using the
observed revision, and handles `thread/readState/changed` notifications directly.
Missing receipts are neutral. An unread marker remains visible on update failure,
including while the thread is selected. Revision conflicts never cause automatic
retry with a fresh revision. Activity arriving during history loading is not
acknowledged by that load.

The obsolete localStorage keys `codex-web-local.thread-read-state.v1` and
`codex-web-local.thread-unread-cutoff.v1` are neither read, written nor removed.
Their timestamps are not converted to native positions. Other preferences remain.

Protocol verification used the installed `@openai/codex` 0.167.2 binary's
`app-server generate-json-schema --experimental` output. Read-state fields are
experimental; the existing WebSocket initialization enables experimental APIs.
This does not establish live authenticated multi-client behavior.

Performance: read notifications update in-memory rows without a history/list
RPC. Mark-read has at most one in-flight request per thread. No storage writes,
polling loops, scans, or retry fanout were added. Browser timing was not measured.

Validation: `pnpm run test:unit` passed (1,218 tests, one skipped);
`pnpm run typecheck`, `pnpm run build`, and
`pnpm run test:integration:fixture` passed. Integration used the credential-free
fixture, not a real Codex server. No live browser/theme or multi-client server
verification was performed. The frontend build emitted 378.59 kB main JavaScript
(123.77 kB gzip); no new runtime dependencies were added.

## Remaining implementation
Native pinning and explicit migration, custom worktree lifecycle removal, and
legacy history retirement are not implemented by the read-receipt change.
Existing history indexes must be inspected for native-list omissions and pending
submissions before retirement; no historical files have been removed or rewritten.
