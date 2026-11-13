# Remote provider model discovery

## Setup

- Connect to an independently managed Codex App Server with `codex` in its command execution PATH and the intended CODEX_HOME/auth environment.
- Configure two providers on that host, including models with the same slug and different reasoning capabilities. Back up configuration and saved UI selections.
- Keep Codex absent from the web backend host to verify remote ownership.

## Actions and expected results

1. Refresh the model selector in light and dark themes. Both providers' actual catalogs appear under their own names; identical slugs remain distinct.
2. Inspect browser requests: one `modelProvider/list`, then serial `model/providerCatalog` bridge requests. On the remote connection each becomes buffered `command/exec` with argv `['codex', 'debug', 'models', '-c', 'model_provider=<id>']`, timeout 30000 ms, and 16777216-byte output cap. No provider argument is sent to `model/list`.
3. Inspect bridge response metadata. Names, visibility, and reasoning capabilities are normalized; instruction templates and raw stdout/stderr are absent. Hidden models are excluded from available IDs, while their capabilities remain available for saved selections.
4. Switch models and reasoning efforts, start a thread, fork it, and send a turn. Existing provider selection semantics and model-specific efforts remain intact. Reload and verify saved selection persistence, including a saved unavailable provider.
5. Make one provider unavailable (test configuration only) and refresh. Other providers remain available and the failed provider ID is reported in `failures`; saved preferences are retained.
6. Simulate command method rejection, missing remote CLI, nonzero exit, timeout, malformed/truncated JSON, and empty catalog. Each fails independently. If every provider fails, the paginated legacy `model/list` result remains a single active catalog, never duplicated across providers. Failure IDs remain present.
7. With a legacy server rejecting `modelProvider/list`, verify `config/read` supplies explicit `model_providers` IDs and the explicit active `model_provider`. If neither is exposed, only the legacy catalog is used; built-in IDs are never guessed.
8. Trigger overlapping refreshes and switch threads while discovery is pending. Requests within the browser share the pending catalog operation, and older refreshes cannot replace newer thread/preferences state.

## Cleanup

Restore test configuration and backed-up selections; remove test threads. Do not restart or reconfigure the production App Server as part of discovery.

## Compatibility and audit evidence

- Official [0.168.0 provider enumeration schema](https://github.com/openai/codex/blob/rust-v0.168.0/codex-rs/app-server-protocol/schema/typescript/v2/ModelProviderListResponse.ts) defines `data`, `defaultProviderId`, and `canChangeDefault`. Provider summaries use `id` and `name`.
- Official [0.168.0 CLI implementation](https://github.com/openai/codex/blob/rust-v0.168.0/codex-rs/cli/src/main.rs) loads config overrides and writes the raw catalog as JSON. The installed 0.167.2 CLI also supports `debug models`.
- An isolated 0.168.0 App Server smoke test enumerated two fixture providers plus built-in OpenAI, then executed the exact remote argv for each fixture provider, returning 12 models per call. This uses a local static catalog and no credentials; it does not validate provider authentication/network discovery. The container's default sandbox failed its socket-directory check; the temporary fixture used an unrestricted sandbox. Production execution uses the existing server's configured sandbox unchanged.
- Later releases are capability-tested at runtime, not assumed compatible. Missing RPC/CLI commands, sandbox restrictions, mismatched command environment/CODEX_HOME, absent provider config, and CLI-side cached/empty catalogs can limit discovery. A CLI can exit zero with an empty catalog; the bridge treats this as provider failure.
- Performance: one provider command at a time, 30-second remote execution limit, 16 MiB capture limit per stream; no threads/turns, local child processes, permanent caches, or global configuration writes. Concurrent browser callers reuse the existing pending catalog promise; existing publication/lifecycle guards reject stale updates. Legacy cursor repetition is bounded. Only normalized metadata reaches the browser. On a 745,260-byte, 12-model 0.168.0 raw catalog, normalization produced 9,374 bytes (98.7% smaller); 100 warmed iterations measured 2.06 ms median and 2.91 ms p95 on this host. This excludes remote command/network latency. No browser profiler was run because the UI/rendering path is unchanged.
