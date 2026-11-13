> Historical native-fork investigation. The ordinary “Fork conversation” and
> “Fork from this response” actions now use [portable conversation transfer](cross-provider-forks.md).
> The native adapter described below is not used by those actions.

# Native cross-provider request compatibility

The implementation is a request-copy projection, not a readable-conversation
transfer. Native `thread/fork` and `lastTurnId` still own stored history and the
response cutoff. User/assistant messages and supported tool calls/results retain
their order and identities. No rollout files are rewritten.

The adapter and patch are repository assets; the npm CLI does not install or
activate them automatically. The running 0.168.0 app-server was **not replaced**. Both original HTTP 400s are
resolved in real inference tests using that server with the projection in an
explicit, thread-scoped forwarding adapter. To make ordinary UI forks use it,
deploy the matching Codex patch below, or explicitly route those threads through
the adapter. The UI does not insert these adapter overrides automatically.

## Implementation

- [Rust projection](../adapters/codex-0.168.0/responses_compat.rs): shared by the
  verification executable and the upstream patch.
- [Matching upstream patch](../patches/codex-0.168.0-request-projection.patch):
  `rust-v0.168.0`, commit `9480ec100c3edee9fc69172e8e80a4730444094d`.
- [Version/hash manifest](../adapters/codex-0.168.0/upstream.json) and
  [patch generator](../adapters/codex-0.168.0/make-patch.py): reject a different
  request-builder source. A repository regression test checks that the patch
  embeds the exact tested normalizer.
- [Forwarding adapter](../adapters/codex-0.168.0/forwarder.cjs): HTTP/SSE and
  WebSocket verification with the same compiled Rust module. It is separate from
  the web application and never starts automatically.

In Codex, projection runs after `input.splice(0..0, prefix)` and before
`ResponsesApiRequest` construction. Thus it sees inherited items and newly
constructed Lite items, before WebSocket prewarm/delta caching. The fast path
skips JSON projection if no incompatible item exists. Additional-tools support
comes from the selected model's Responses Lite dialect, not its model name.
The built-in OpenAI provider gets its known reasoning-input policy. The adapter
accepts explicit destination capabilities for other routes; do not reuse a
profile on a destination whose dialect has not been established.

### Tool declarations

For a standard destination, current top-level tools are the authoritative active
handler inventory. They are retained unchanged, including parameters, custom
formats, built-ins and namespace structure. Inherited `additional_tools`
declarations are indexed chronologically by qualified name; later declarations
supersede obsolete ones, while current registered definitions take precedence.
Matching declarations already have their supported top-level representation.
Retired inventories are not re-advertised as nonexistent handlers.

Completed ordinary function-call/result records remain historical observations,
including calls to retired functions. Call IDs, arguments, outputs and ordering
are not rewritten. Call/output kinds must pair correctly. No arbitrary namespace
flattening, custom-to-function wrapping, shell translation or handler revival is
attempted. Custom calls require a matching registered custom handler; unsupported
namespaced calls, ambiguous dotted declarations, orphan results, hosted/search
state and encrypted compaction state fail explicitly. An authoritative active
inventory is required; missing tools cannot be "fixed" by dropping declarations.

The OpenAI-to-Qwen audit retained all current destination tools, retired the old
source inventory, and then executed the destination shell tool successfully.
This is not a rule that simply deletes every `additional_tools` item regardless
of tool state.

### Reasoning

At the production rejection boundary, a transparent WebSocket forwarding probe
correlated one request trace with `array_above_max_length`, parameter
`input[3].content`. That exact item was `reasoning`, with a content array of
length 1 containing `reasoning_text`. Only field names, types and lengths were
logged. The WebSocket prewarm completed first, so this was the actual delta
request sent upstream. Earlier capture-only failures prevented prewarm and
produced a full request with different indices; that explains the earlier
uncertainty rather than implying an arbitrary content-array rule.

For a destination rejecting this extension, foreign plaintext reasoning is
preserved in an explicitly labeled assistant text item **in the request copy**.
Its summary and reasoning text remain available, but it is not asserted to be
native hidden reasoning state. This change affects only nonempty, unsupported
reasoning content. Valid native encrypted/summary-only reasoning and ordinary
message content arrays are untouched.

Moving plaintext into a native reasoning `summary` alone was insufficient: the
first response completed, but subsequent `previous_response_id` replay failed
with `unsupported_persisted_item_context` because the service could not verify
foreign hidden state. The labeled text representation passed first-response,
real tool execution and subsequent-turn tests. Unknown reasoning content shapes
and combinations with opaque encrypted state are rejected instead of discarded.
No general translation of encrypted state between providers is provided.

## Deploy the Codex patch

Use a source checkout/export at the exact revision above. Applying the patch and
building does not require changes to model names, provider defaults or credentials:

```sh
# CODEX_SOURCE must already contain rust-v0.168.0 source.
git -C "$CODEX_SOURCE" apply --check "$CODEXAPP_ROOT/patches/codex-0.168.0-request-projection.patch"
git -C "$CODEX_SOURCE" apply "$CODEXAPP_ROOT/patches/codex-0.168.0-request-projection.patch"
cd "$CODEX_SOURCE/codex-rs"
cargo check -p codex-core --lib
cargo build --release -p codex-cli --bin codex
```

The release tag sets workspace package versions to 0.168.0 while its checked-in
lockfile still contains local packages at 0.0.0. The initial non-locked Cargo
command refreshes those local versions. A subsequent `cargo check --locked`
passed. This patch adds no upstream dependencies. The patched library was checked
with Rust 1.99.1; upstream specifies Rust 1.95.0. Only existing upstream
`fetch_update` deprecation warnings were observed.

An operator must then start a separately managed verification app-server with
the built binary, matching user, CODEX_HOME, credentials and filesystem paths.
Verify the matrix before replacing the production app-server binary. This task
neither replaced nor restarted the existing app-server. The web application
continues to connect by JSON-RPC; it does not spawn Codex or sanitize displayed
history as a substitute for inference-history projection.

To regenerate the patch, export the original tag into a clean directory and run:

```sh
python3 adapters/codex-0.168.0/make-patch.py "$PRISTINE_CODEX_SOURCE"
```

## Run the scoped adapter verification

Build the [normalizer](../adapters/codex-0.168.0/README.md) first. Start these in
separate terminals from this repository with dependencies installed:

```sh
COMPAT_PROBE="$PWD/adapters/codex-0.168.0/target/release/responses-compat-probe"
node adapters/codex-0.168.0/forwarder.cjs --port=4213 \
  --upstream=https://chatgpt.com/backend-api/codex \
  --policy='{"additional_tools":true,"reasoning_content":false,"namespaces":true}' \
  --project=true --binary="$COMPAT_PROBE"
```

```sh
COMPAT_PROBE="$PWD/adapters/codex-0.168.0/target/release/responses-compat-probe"
node adapters/codex-0.168.0/forwarder.cjs --port=4214 \
  --upstream=https://api.class2.llm.ai.r-ccs.riken.jp/v1/ \
  --policy='{"additional_tools":false,"reasoning_content":true,"namespaces":true}' \
  --project=true --binary="$COMPAT_PROBE"
```

These are explicit policies for the audited routes, not model-name conditionals
inside the normalizer. The adapter preserves the incoming path on its configured
upstream origin. The thread-scoped base URL must therefore retain the upstream
path prefix. For OpenAI, retain `/backend-api/codex`: changing that suffix affects
backend-route detection, model catalog/prewarm behavior and request context.

The live verifier uses only these supported fork overrides, with provider/model
still explicitly selected:

```json
{"config":{"openai_base_url":"http://127.0.0.1:4213/backend-api/codex"}}
```

```json
{"config":{"model_providers.rivault.base_url":"http://127.0.0.1:4214/v1/"}}
```

Run the opt-in matrix:

```sh
node adapters/codex-0.168.0/verify-live.cjs --run-live=true \
  --server=ws://127.0.0.1:4500 --report=/tmp/native-projection-verification.json
```

The verifier creates only disposable threads, verifies complete source/cutoff
item arrays and source provider/model metadata, and checks actual durable command
execution/result evidence rather than assistant claims. Same-provider controls
check three completed continuation turns without adapter overrides. The negative
case appends a clearly synthetic unsupported custom-call fixture to a disposable
child through `thread/inject_items`; it does not claim that synthetic tool ran,
and does not inject into the original source. Known terminal outcomes are required
before archiving. Unknown outcomes remain listed for explicit inspection.

The adapter binds localhost, keeps bodies/credentials only in memory, and forwards
authorization only to its explicitly configured upstream. JSON IPC carries private
request data between adapter and Rust executable; do not tee or retain those IPC
streams. Diagnostic stdout contains structural metadata and counters only. The
adapter performs no retries and does not rewrite saved history. Stop both adapter
processes after validation; do not stop the independently managed app-server.

## Validation and remaining limits

[Redacted evidence](fixtures/native-provider-projection-validation.json) separates
real-provider results from credential-free tests:

| Real-provider case | Completed response | Actual tool/result | Subsequent turn |
| --- | --- | --- | --- |
| OpenAI to Qwen, full fork | Pass | Pass | Pass |
| OpenAI to Qwen, response cutoff | Pass | Pass | Pass |
| Qwen to OpenAI, full fork including tool history | Pass | Pass | Pass |
| Qwen to OpenAI, response cutoff | Pass | Pass | Pass |
| Same-provider controls | Pass | Not requested | Pass |

All source-history hashes and intended prefixes matched. The unsupported custom
conversion failed locally with a clear error and no source mutation. Namespace,
duplicate/obsolete declaration, call/result mismatch, missing-registry, compatible
reasoning and unsupported opaque/content cases also have Rust regression tests.
The packaged server binary has not been rebuilt/deployed here; real inference
used the installed 0.168.0 server plus the exact compiled normalizer in the scoped
adapter. The matching patched `codex-core` library typecheck passed separately.
The ordinary unmodified server routes still require deployment of this fix.

No claim is made that arbitrary custom tools, hosted tools, encrypted compaction,
or opaque cross-provider reasoning can be converted. Those cases require a
semantically valid registered adapter or an explicit unsupported-history error.
A manual readable-context transfer remains a separate workaround; no frontend
transfer feature was added or represented as native hidden-state preservation.

## Performance

Core projection adds no API, filesystem or thread-loading requests. Compatible
input takes a typed linear scan with no JSON conversion. Incompatible input incurs
linear request-copy serialization/projection/deserialization; current tools are
read afresh, so there is no new cache to invalidate when model/tool configuration
changes. Projection happens before WebSocket diffing and prewarm caching.

The separate verification adapter adds a localhost hop and JSON IPC, bounds input
to 32 MiB and pending projection work to eight requests, and forwards streamed
responses without buffering the full successful response. It does not add
inference retries or request fanout. Structural diagnostic volume scales with the
number of input items; the production core patch logs only aggregate counters.
A 25-iteration synthetic release-probe measurement of 2,000 messages (460,281-byte
request) measured 12.74 ms median and 15.22 ms p95, including JSON IPC. The debug
probe measured 95.78 ms median. These are local projection measurements, not
provider-latency benchmarks or a measurement of the optimized in-process core path.
