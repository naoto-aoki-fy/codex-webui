# Phase 9-D-8: Model and Reasoning Preference Extraction Audit

## Conclusion

Phase 9-D can be considered complete without further extraction. A narrow extraction of pure ordering and fallback calculations is feasible, but it is optional maintainability work. Reactive ownership, refresh coordination, persistence effects, and submission configuration should remain in `useDesktopState()`.

No source, test, or documentation changes were made during the audit. No performance improvement is claimed: this was code-path analysis, not runtime profiling.

## Structure and dependencies

Line references below refer to `src/composables/useDesktopState.ts` at commit `11ef5ae`.

| Responsibility | Location |
|---|---|
| Catalog IDs, usage ordering, preference refs and computed state | Lines 448–487 |
| Effective model lookup, availability, selection sync and setters | Lines 697–775 |
| Collaboration preference setters | Lines 795–818 |
| Reasoning lookup, keys, defaults and setter | Lines 841–879 |
| Speed update, collaboration refresh and pending-turn labels | Lines 881–926 |
| Model/config refresh and request guards | Lines 928–961 |
| Preference pruning after thread removal | Lines 1140–1145 |
| Refresh scheduling and thread selection | Lines 2841–2925 |
| Existing/new-thread submission | Lines 3098–3368 |
| Lifecycle invalidation and catalog clearing | Lines 3670–3689 |
| Public preference API | Lines 3758–3802 |

Persistence codecs and legacy recovery already live in `src/composables/desktopStatePersistence.ts` (lines 116–260). The shared catalog, capability resolution, and config/catalog requests live in `src/api/codexGateway.ts` (lines 874–931).

Data flow: persistence codecs load into composable-owned preference refs; gateway config and catalog feed a guarded refresh; selected-thread context resolves the effective model; that model and the shared reasoning catalog resolve effort/options; submission snapshots preferences, may update the model after resume, then sends configuration through the gateway.

`reasoningCatalog` is a gateway-owned singleton ref. The composable populates and clears it, and gateway submission reads it. Do not create a second catalog store. Model availability, recent usage, explicit preferences, automatic fallback, selected display, speed, and collaboration state belong to each composable instance. Preserve existing refs and computed identities, including the public ordered `availableModelIds` computed.

## Behavior and ordering

- Available recent models sort first, followed by the remaining catalog order.
- Automatic catalog fallback affects display and does not overwrite the saved user choice.
- Refresh selection precedence is saved model, configured model, then first catalog ID. An empty catalog can retain the saved or configured model.
- Explicit model selection also updates the new-chat default and recent usage. Server-reported thread model updates use a distinct path.
- Selecting an effort also updates the new-chat model default.
- Effort resolution uses a supported request, supported catalog default, first supported effort, then an empty value. The config's `reasoningEffort` is not applied by this refresh path.
- Submission snapshots effort before asynchronous work. Resume can update the model; gateway submission resolves effort again against the shared catalog.
- Speed is written through gateway configuration, not sent as a separate turn argument.

Persistence stores model and collaboration choices by context. Reasoning preferences are keyed by provider/model and therefore shared across threads using that model. Legacy keys, new-thread contexts, malformed-data handling, and storage exception boundaries must remain intact.

## Safeguards and risks

Refresh captures lifecycle generation, model-refresh version, and selected thread ID. It checks lifecycle after both awaits and rejects stale success or failure mutations. `stopPolling()` increments lifecycle and refresh versions and clears the shared catalog.

No new user-facing bug was confirmed. Risks to characterize before changing behavior:

- Speed updates have no lifecycle/version check and can overlap model refresh.
- Multiple composable instances have independent refresh counters while sharing the catalog.
- A selection change A→B→A during refresh is checked by thread identity, not selection generation.
- Overlapping refreshes are guarded against stale writes but are not cancelled or coalesced.
- Submission can combine a captured effort with a model updated after resume; preserve current ordering.
- The real gateway catalog loader catches request failures and returns an empty catalog, unlike mocked catalog rejection paths.

Ordering and catalog scans are small linear operations. Refresh performs sequential config and paginated catalog requests; overlapping refreshes can duplicate work. Pagination stops on repeated cursors but has no fixed page cap. Preference setters synchronously serialize whole maps. No runtime cost was measured.

## Extraction recommendation

| Candidate | Assessment |
|---|---|
| Pure usage/catalog ordering | Low risk if arrays are explicit inputs and order, duplicates, and immutability are preserved. |
| Pure catalog fallback calculation | Low to moderate risk; return IDs and fallback choice, while keeping context reads and reactive mutation in the composable. |
| Pending-turn label formatting | Low risk with explicit inputs, though too small to justify extraction alone. |
| Stateful preference controller | High coupling; retain in the composable. |
| Refresh coordinator or submission configuration | High compatibility risk; retain in the composable. |

If pursued, a future helper could be `src/utils/desktopModelPreferences.ts` with focused unit tests. It should import types only, accept plain values, and avoid importing the composable or gateway, creating refs, reading storage, or invoking callbacks. This avoids circular dependencies and duplicate state ownership.

## Existing tests and gaps

Coverage exists in `useDesktopState.modelPreferences.test.ts`, `useDesktopState.messages.test.ts`, `desktopStatePersistence.test.ts`, and `codexGateway.test.ts` for model-specific effort persistence, capability defaults, fallback recovery, catalog arrival, recent usage, submitted-model recording, legacy recovery, malformed storage, catalog pagination, stale refreshes, selection changes, CLI banner behavior, disposal, and lifecycle restart.

Before extracting fallback logic, add characterization for empty catalogs, every fallback precedence branch, selected-thread versus new-chat defaults, input immutability, and unchanged saved preferences. Useful additional coverage includes stale successful refreshes after selection changes, speed-update races, and effort/model behavior during deferred resume.

## Verification

- `pnpm run typecheck` — passed.
- `pnpm run build` — passed.
- `pnpm run test:unit` — 65 files and 881 tests passed.
- `pnpm run test:integration:fixture` — passed.
- `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture` — passed, run sequentially after the first transport.

Fixture integration checks cover built CLI and dev entry points, not live authenticated Codex behavior. The working tree was clean after verification.

## Proposed next step

Close phase 9-D without another extraction. If maintainability work is desired later, scope it narrowly to pure ordering and fallback calculations in `src/utils/desktopModelPreferences.ts`, with focused characterization tests; keep state mutation and request guards in the composable.
