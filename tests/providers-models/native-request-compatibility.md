# Native cross-provider request projection

Prerequisites: Rust 1.95+, repository dependencies, a separately managed Codex
0.168.0 server, and credentials for the two audited provider routes. Build the
projection and start the two explicit localhost adapters using the
[deployment and verification instructions](../../docs/native-provider-compatibility.md).
Do not change shared provider defaults or use unrelated conversations.

Actions and expected results:

1. Run `cargo test --locked --manifest-path adapters/codex-0.168.0/Cargo.toml`.
   Declaration updates, namespace collisions, unsupported custom conversions,
   orphan/mismatched results, plaintext reasoning and compatible native state
   must pass their focused fixtures. Inputs and current tool definitions remain
   unchanged; errors contain no private content.
2. Run the explicit `verify-live.cjs --run-live=true` command from the guide.
   Both directions must complete a response, an actual tool-call/result round
   trip and another turn for full forks and response-cutoff forks. Check durable
   command results, not just text claiming that a tool ran.
3. Confirm cutoff forks contain exactly the selected prefix, full forks retain
   all source items, and source history/provider/model stay unchanged. Both
   same-provider controls must complete without adapter configuration.
4. Confirm the synthetic unsupported custom-call case fails locally with a clear
   conversion error. No unavailable tool is invented, tool relationships are not
   erased, and the original source remains unchanged.
5. For boundary diagnosis only, use `--project=false` on a separate scoped adapter.
   Confirm the exact upstream rejection and request structural metadata share a
   trace ID. Allow prewarm to complete before interpreting delta item indices.
   Never log reasoning text, prompts, credentials or sensitive tool output.

Cleanup: the verifier archives only created threads with confirmed terminal
outcomes. Inspect any reported unknown outcomes before cleanup; never replay
unknown requests automatically. Stop the two adapter processes, retain the
independently managed app-server, and verify global provider configuration is
unchanged. Deployment of the patched server is a separate operator action.
