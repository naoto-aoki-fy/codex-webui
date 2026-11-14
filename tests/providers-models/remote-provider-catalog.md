# Native provider model discovery (Codex CLI 0.169.0)

## Setup

- Connect to an independently managed Codex 0.169.0 App Server with its intended configuration and credentials. The web backend does not need a Codex binary.
- Configure two providers, including a non-default provider and identical model IDs with different reasoning capabilities. Back up configuration and saved UI selections.

## Actions and expected results

1. Refresh the model selector in light and dark themes. Providers appear under their own names; identical IDs remain distinct.
2. Inspect requests: one `modelProvider/list`, followed by serial `model/list` walks. Every page carries the same explicit `modelProvider` and `includeHidden: true`; subsequent pages carry that provider's cursor. There are no discovery `command/exec` requests.
3. Check names, provider-specific defaults (`isDefault`), supported/default reasoning efforts, and hidden flags. Hidden models are excluded from available IDs but retain capabilities for saved selections.
4. Select a model, create/fork a thread and send a turn. Creation/fork sends the provider and raw model ID; turns retain the thread provider. Reload and verify saved selections persist.
5. Make one test provider unavailable, reject a native model request, or inject a malformed response/later-page failure. Successful providers remain available; failed provider IDs appear in `failures`. Partial pages from a failed walk are discarded. If all providers fail, no unrelated active catalog replaces them. An empty native catalog is valid.
6. Inject repeated and cyclic cursors. Walks stop without repeating requests indefinitely. Each provider starts without a cursor, even after another provider fails.
7. Reject `modelProvider/list` as unsupported: `config/read` supplies explicit `model_providers` IDs and the active `model_provider`. If neither discovery source is available, the same native reader can retrieve an unqualified active catalog. No provider IDs are guessed and no CLI fallback runs.
8. Trigger overlapping refreshes and switch threads while discovery is pending. Overlapping callers share one catalog operation; after completion, refresh requests fresh data. Existing publication guards protect current thread/preferences state.

## Cleanup

Restore test configuration and selections; remove test threads. Discovery must not restart or reconfigure the independent server.

## Automated coverage and performance audit

Run `pnpm run test:unit`, `pnpm run typecheck`, `pnpm run build`, then
`pnpm run test:integration:fixture`. Gateway tests cover provider isolation,
qualified identities, metadata, hidden models, pagination, cursor cycles, retries,
and coalescing. The fixture checks native provider parameters and two pages over
the existing initialized WebSocket in both built and development entry points.
It is a controlled protocol fixture, not live Codex 0.169.0 verification.

Code-path audit: one provider/page RPC is outstanding at a time; request count is
one enumeration plus the sum of provider pages (with `config/read` only for
unsupported enumeration). Repeated cursors terminate each walk. Native responses
avoid spawning catalog commands, parsing captured CLI output, or transferring
instruction templates. No new synchronous filesystem work, connection, persistent
cache, or configuration invalidation is introduced. The existing in-flight promise
coalesces concurrent refreshes and clears on completion. Unique cursors still rely
on the server eventually terminating pagination. Live latency and browser rendering
were not measured; the UI rendering path is unchanged.
