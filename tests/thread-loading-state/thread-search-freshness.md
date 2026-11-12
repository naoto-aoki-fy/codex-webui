# Native conversation search

Prerequisites: connect an independently managed Codex app-server supporting
`thread/search` (verified: 0.167.2). Use the same account and CODEX_HOME as the app.
Have several nonarchived interactive threads, including an older thread outside
the newest 100, with known English/Japanese user and assistant text.

1. Open sidebar search. Enter a phrase unique to a user message, then one unique
   to an assistant response, both absent from titles/previews. Expect the correct
   conversations. Repeat with Japanese text and the older thread.
2. Search a common term across multiple conversations. Inspect RPC traffic:
   `thread/search` sends updated-at descending, page size 100, and each returned
   cursor until null. Expect all returned threads, including previously unloaded
   rows. No `thread/read` is issued solely to search.
3. Click a result. Expect the matching `/thread/<id>` route and conversation;
   normal navigation may now read that thread's history.
4. Enter a unique absent term. Expect no matching rows. Clear search: expect the
   normal sidebar. Enter a title-only substring: loaded title/preview matches
   remain visible alongside native matches.
5. Change the query rapidly or clear it while RPCs are pending. Expect obsolete
   responses not to replace the current query. Add a persisted message externally,
   change the query away and back: expect a fresh search without a cached index.
6. Connect an older server without this method, or disable the capability in a
   disposable client. Expect an explicit content-search error and loaded metadata
   filtering, with no full-history fallback or false empty-success response.
7. Repeat search/result selection in light and dark themes. Expect normal themed
   sidebar surfaces and readable error text.

Automated checks: `pnpm exec vitest run src/api/codexGateway.search.test.ts
src/server/appServerWebSocketClient.test.ts`. Coverage includes >100 results,
Japanese query forwarding, no history calls, hydration, empty results, errors,
repeated cursors, and the experimental initialization capability.

Known differences: native message search excludes command-output-only discovery;
title-only matches in unloaded metadata are not guaranteed. See
[protocol review and live results](../../docs/thread-search-design-review.md).

Cleanup: clear search. Restore the original external server after compatibility
tests. Read-only searches require no filesystem rollback; remove any manually
created test conversations using normal archive controls.
