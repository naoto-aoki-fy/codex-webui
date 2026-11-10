# Thread Search Design Review

## Recommendation

Prefer title and preview search (approach A), unless searching historical message bodies is a confirmed product requirement. The frontend already matches these fields. Removing the separate server snapshot avoids history reads, stale search state, and duplicated ownership of thread metadata.

## Current implementation

The first nonempty search lazily builds an in-memory index in `src/server/codexAppServerBridge.ts`. It pages through every nonarchived thread using `thread/list` (100 per page, sorted by `updated_at`) and uses the trimmed thread name, falling back to preview and then “Untitled thread.” It then reads complete histories for at most the first 100 threads, in batches of four, using `thread/read` with `includeTurns: true`.

For N valid rows, initial indexing makes approximately `ceil(N / 100)` list calls and `min(N, 100)` thread-read calls. At the cap, history reads take 25 sequential batches. This is lazy, rather than application-startup work, but the first search waits for indexing to finish. History payload size and extraction work are not bounded by thread length. Failed reads silently leave metadata-only documents, with no retry while the snapshot lives.

`extractThreadMessageText` indexes assistant text, user text blocks, command strings, and aggregated command output. Other item types, including file changes and images, are omitted. Matching is case-insensitive substring matching against title, preview, or extracted message text. Results preserve list order, have no snippets or match location, and are capped by the endpoint at 1,000. `searchableText` is stored but not used. Relevant references: document types and cap at `src/server/codexAppServerBridge.ts:96`, extraction at `:1170`, loading at `:3734`, lazy cache at `:3810`, and endpoint at `:4817`.

The cache has no TTL or normal invalidation. New messages, renames, creation, archive, deletion, rollback, and external changes can leave it stale until middleware disposal. The frontend query watcher reruns only when the query changes (`src/App.vue:1272`). The sidebar first matches title/preview locally, then treats server IDs as authoritative (`src/components/sidebar/SidebarThreadTree.vue:693`), so a rename can appear locally and disappear when stale results arrive.

Search enumerates with native `thread/list`, while normal UI listing uses persistent-index merging and canonicalization (`src/server/codexAppServerBridge.ts:3581`, `:1230`). Recovered attachment-only or imported threads visible in the sidebar may therefore be absent from search. The separate `/thread-index/rebuild` maintenance route rebuilds the persistent visibility index, not this search snapshot.

All listed threads receive metadata matching, but only the newest 100 at index-build time receive body matching. Older threads silently lose body-only discoverability; a failed read reduces coverage further. `indexedThreadCount` reports total documents, not full-text coverage, and the UI does not surface this limitation. The endpoint returns IDs only, so it cannot hydrate sidebar pages that have not yet loaded.

The dependency chain is narrow: `App.vue` query watcher → `src/api/codexGateway.ts:1492` `searchThreads` → server endpoint → `SidebarThreadTree.vue`. Full-text search is not used by conversation rendering, composer file search, or other pickers.

## Options

### A. Search titles and previews only

Retain sidebar search across project groups, chronological rows, projectless chats, and pinned threads. Remove message-body-only matches. Reuse the existing local matcher and remove the server search endpoint, gateway helper/result type, index document and cache machinery, history extraction helper if otherwise unused, full-text limit, and frontend debounce/server-result state and prop. No npm dependency is used exclusively by this search.

Search-specific RPC work becomes zero; each query scans the metadata already in frontend state. Results can follow the current displayed title and preview. Coverage while sidebar pagination is incomplete needs attention: make incomplete results clear or ensure remaining metadata pages load. Regression checks should cover renames, previews, new and recovered/imported threads, pinned and chronological views, and search during partial pagination.

Estimated complexity: low, roughly 1–2 engineering days including focused regression coverage.

### B. Keep full-text search and improve its design

Retain message and command/output discovery. Split metadata enumeration, extraction/cache, and query matching into distinct responsibilities. Add bounded per-thread cache memory, deduplicated reads, concurrency limits, and invalidation for turns, renames, rollback, archive/delete, and thread creation. Reconcile external changes and reconnects with TTL or refresh logic; guard against stale reads racing invalidation; expose coverage and failed reads; refresh frontend results when the index changes and cancel obsolete queries.

Warm searches could become faster, but cold indexing still needs history requests. Persisting a complete index may reduce repeated reads but adds storage, migration, consistency, and cleanup work. A TTL alone would repeat expensive builds while preserving staleness windows and partial coverage.

Estimated complexity: medium to high, roughly 4–8 engineering days for a bounded in-memory service; broad persistent coverage adds more work. Main risks are invalidation races, memory growth, incomplete coverage, and divergence from the canonical thread list.

## Decision

Choose A unless historical message-body search is a confirmed requirement. It removes a costly, stale snapshot that serves only one frontend feature. Preserve the persistent thread index, title cache, normal history loading, and pagination: they have separate responsibilities. Document the loss of body-only matches and handle incomplete sidebar pagination explicitly.

These performance conclusions come from code-path analysis; no live latency, memory, or payload measurements were taken.
