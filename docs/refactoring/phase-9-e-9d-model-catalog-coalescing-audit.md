# Phase 9-E-9d: Model Catalog Request Coalescing Audit

## Scope and conclusion

This was a read-only audit of model configuration and catalog requests. No production code, tests, or documentation were changed during the audit, and no commit was created then. The recommendation is to leave requests uncoalesced before 9-E-10: duplicate work exists, but its frequency and latency cost were not measured, while sharing introduces freshness and lifecycle choices that publication guards do not settle.

## Current request flow

`useDesktopState.refreshModelPreferences()` acquires a lifecycle lease and publication sequence, then captures lifecycle generation, instance-local refresh version, and selected thread. It awaits `getCurrentModelConfig()` (`config/read {}`), checks lifecycle, then awaits `getAvailableModelIds()` (sequential `model/list` pages). Before applying results it checks lifecycle, refresh version, and thread selection. It resolves that caller's saved/configured model preferences, updates local state, publishes catalog capabilities through its lease, and updates displayed speed mode.

Refreshes are initiated by ancillary refreshes and thread selection. Ancillary work runs alongside rate limits, collaboration modes, and skills; config and catalog requests within one refresh are sequential.

Gateway contracts differ. `getCurrentModelConfig()` normalizes config and rejects on failure. `getAvailableModelIds()` preserves valid model records and page order, retains duplicate records, and deduplicates trimmed IDs in first-seen order. It trims cursors, terminates on missing or repeated cursor, and discards all accumulated pages on any failure, resolving empty arrays. Fetching does not publish the shared catalog.

Submission with an explicit model does no config/catalog lookup. Collaboration-mode submission without a model reads config, then falls back to the first available catalog ID if config fails or has no model. After that await, reasoning effort is resolved against the current shared `reasoningCatalog`, not the fallback response. It then sends `turn/start`.

## Existing concurrency behavior

There is no model request coalescing in the composable, Gateway, RPC client, or inspected server forwarding path. Each overlapping refresh starts its own config and catalog requests. A superseded refresh can still proceed from config to catalog while its lifecycle is current. Instance version/thread guards govern local application; shared leases and refresh sequences govern publication.

Across instances, an earlier success may publish while newer work is pending, but cannot overwrite a newer successful publication. Failures do not advance publication authority. Stop invalidates lifecycle/version and releases ownership; outstanding network work continues but cannot affect the stopped lifecycle. Restart creates fresh ownership. Submission fallback requests are independent and do not publish capabilities.

## Request counts and performance

Let `P` be the number of catalog pages attempted:

- One successful refresh: `1 + P` model RPCs.
- `N` complete refreshes: `N × (1 + P)`.
- Config failure: one RPC.
- Explicit-model submission: zero lookup RPCs, then `turn/start`.
- Config-resolved submission: one lookup RPC, then `turn/start`.
- Catalog fallback submission: `1 + P` lookup RPCs, then `turn/start`.

Perfectly overlapping equivalent requests could theoretically save `(N − 1) × (1 + P)` calls. This is a static upper bound, not a measured benefit. Each refresh has at most one model RPC outstanding, but aggregate fanout grows with concurrent refreshes/submissions. Pagination is sequential and stops repeated cursors, but has no cap on an indefinitely unique cursor stream. Catalog assembly and ID normalization are expected `O(M + P)` time and memory for `M` records, repeated per fetch. No live latency, payload, request-frequency, or network measurement was made.

Existing retention includes the shared catalog, per-instance IDs/preferences, lease tokens, and pending RPC data. There is no settled config/catalog result cache or explicit browser RPC timeout.

## Options considered

| Option | Benefit | Main risks and cost |
|---|---|---|
| A. No coalescing | None; preserves independent observations and retry behavior | Retains duplicate work; lowest complexity and current memory behavior |
| B. Same-instance in-flight sharing | Saves overlapping work in one composable | Later refresh accepts earlier observation/outcome; needs lifecycle-scoped pending state, settlement cleanup, guards, and hung-request handling |
| C. Gateway in-flight sharing | Broadest savings across consumers | Couples consumers to earlier observations/failures; needs server/session context, safe ownership, result isolation, cleanup, and lifecycle handling |
| D. Short-lived result cache | Can save nonoverlapping calls | Can serve stale config/capabilities; needs TTL, bounded retention, invalidation for writes/reconnect/account changes, and must not cache failure-derived empty results |

All sharing must retain per-caller leases, publication sequences, refresh versions, selection checks, and preference resolution. Stopping one owner must not cancel another owner's work; old completion cleanup must not erase a newer pending request. A positive TTL is not justified by an observed invalidation boundary; zero post-settlement reuse reduces D to in-flight sharing.

If later measurements justify work, the narrowest candidate is same-instance, lifecycle-scoped sharing of fetched data while keeping selection and publication per invocation. This still requires an explicit policy that later calls accept an earlier observation. Another narrow possibility is checking version/thread guards immediately after config resolves to skip superseded catalog work; that changes request-count behavior and requires characterization.

## Coverage and gaps

Existing tests cover same-instance and cross-instance reverse completion, pending/newer publication ordering, stale success/failure, retries, stop/restart, lease release, exact mocked refresh call counts, two-page pagination, catalog failure followed by retry, deferred submission fallback, and preference persistence. Relevant suites include `src/composables/useDesktopState.messages.test.ts`, `src/api/codexGateway.test.ts`, and `src/composables/useDesktopState.modelPreferences.test.ts`.

Before any optimization, add characterization for exact HTTP counts under overlapping real Gateway refresh/submission fallback; config changes between overlapping calls; duplicate/malformed catalog records and cursor cycles; later-page failure discarding partial data; failed shared request followed by retry; old-promise cleanup racing replacement; one owner stopping while another remains; hung requests and bounded retention; mutation isolation; and independent selection resolution when data is shared. Distinguish a real catalog transport failure (resolved empty result) from a mocked rejection.

## Recommendation and boundary

Keep Option A before 9-E-10. Do not add a generic RPC cache or alter the public Gateway API. Reconsider only if profiling or request traces show material duplicate cost. Any future implementation should have an explicit session/lifecycle boundary and preserve model-list normalization, page ordering, duplicate handling, pagination termination, failure fallback, shared catalog ownership, publication ordering, stale-refresh guards, preference persistence, and submission-time capability lookup.

## Verification and state

Audit verification passed: `pnpm run typecheck`; `pnpm run build`; `pnpm run test:unit` (73 files, 1,148 tests); `pnpm run test:integration:fixture`; and `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture`. Both fixture transports passed for built CLI and development entry points. These fixture results do not measure live Codex freshness or performance.
