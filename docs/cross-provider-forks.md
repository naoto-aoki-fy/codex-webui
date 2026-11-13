# Cross-provider forks and recovery

## Current boundary

The web application connects to an independently managed Codex app-server over
JSON-RPC. It does not construct the model's HTTP Responses request. The installed
`@openai/codex` development dependency is pinned to 0.167.2; it does not determine
the version of that independently running server. `pnpm exec codex --version`
reported `codex-cli 0.167.2` locally. The reachable external server identifies as
`codex-web-local/0.168.0`; its remote `codex --version` reports 0.168.0.

Full forks use `forkThreadById` → gateway `thread/fork`. Response forks use
`forkThreadFromTurn` → `thread/fork-at-response`. The bridge reads the source,
passes `lastTurnId`, then verifies both returned and durably read turn IDs exactly
match the prefix through the selected response. No rollback of the source occurs.
Both entry points mark the child as fresh. A provider change before sending uses
`configureFreshFork` to fork **that child prefix**, with explicit `modelProvider`,
`model`, and `persistExtendedHistory`. Returned identity and destination must match.
These checks establish configuration, not compatibility of inherited model input.

The first message uses `turn/start`. Its reply is acceptance only. `error` and
`turn/completed` can subsequently report a provider schema rejection. Previously,
the app archived the recoverable prefix immediately upon acknowledgment. It now
retains it until a matching explicit `status: completed` notification. Failure,
interruption, missing IDs, disconnection and unknown outcomes retain the draft;
no automatic replay occurs. Events preceding the RPC response are buffered by
turn ID (bounded to 16); stale turn IDs cannot finalize the draft. Callbacks are
bound to the application lifecycle and originating thread, not the current view.
A second submission is rejected visibly while the first outcome remains pending.
The mounted composer retains its complete draft until the application calls its
submission settlement callback with acceptance. Rejection keeps text, images,
files, skills and persisted storage; acceptance does not erase newer edits.

Reconnect hydration carries durable per-turn statuses through `thread/read` and
`thread/resume`. The tracker matches its acknowledged turn ID against those
statuses. Completed, failed and interrupted outcomes settle the tracker in the
same application instance. Idle alone never means success: an idle reconnect
snapshot without a matching terminal outcome settles as unknown, preserves
recovery, and explains that the user must inspect output/tool effects before an
explicit new submission. A read failure retains the tracker for later recovery.
Background tracked threads are hydrated serially, after the selected thread.

A recovery reference is separate from archive permission. Submitting from a
prefix invalidates its disposable status, including a same-provider continuation;
a previously failed child can then never archive that reused prefix. Cleanup is
bound to the originating submission token and storage ownership. A delayed archive
callback only removes the archived prefix from the list and its fresh marker;
it cannot clear a later child submission's pending state. Reusing a prefix while
its archive RPC is already running is rejected visibly, with its draft retained.

On failure the error identifies the retained prefix route. The submitted prompt,
image references, skill references and file attachments are retained in separate
profile-scoped browser recovery storage while inference is pending. Every
recovery attempt writes its current payload, including edited same-provider
attempts. Configured children keep their own recovery copy as well as the prefix
alias, so concurrent prefix reuse cannot erase the earlier attempt. A child retried after its prefix is reused stores recovery under its own
thread, rather than overwriting the independent prefix's payload. Its composer
loads that payload when no newer ordinary draft exists. On failure it is also
restored to ordinary composer storage if that storage has no newer draft. Recovery
storage is cleared on matching success, including a later same-provider send from
the recovered prefix. Storage failures do
not destroy the server-side prefix. The draft remains provider-editable after
refresh. Remounting does not reconstruct an in-flight outcome tracker, so it
conservatively leaves the prefix unarchived; operators may archive it manually
after checking completion. The app does not automatically resend stored prompts.

## What is established, and what is not

The reported `input[3].content` error alone does **not** establish the item's type.
Nonempty `reasoning.content` is present in the redirected runtime capture, but
the rejected production item at index 3 was not captured. The incompatible-history fixtures drive
**notification recovery tests using error strings**. Their input arrays are not
processed by an adapter or provider; they do not test request normalization,
reasoning compatibility, tool declaration preservation, or successful inference. Clearing all arrays or removing
all reasoning is unjustified. `additional_tools` is explicitly rejected by the
reported destination; a missing LiteLLM fallback is secondary.

A local Codex source reference at commit `c0cc9fc` has two relevant paths:
`codex-rs/core/src/client_common.rs::Prompt::get_formatted_input_for_request`
retains reasoning and additional-tools items, and
`codex-rs/core/src/client.rs::build_responses_request` (request construction near
`model_info.use_responses_lite`) generates a new `AdditionalTools` prefix from
`prompt.tools` on the Lite path, omitting top-level tools there. Thus this item
can be newly generated as well as inherited. This reference is **not** evidence
of the deployed binary's version or this incident's actual path.

Initial process inspection was misleading: no listener was visible with `lsof`,
no app-server process appeared in the tool's process view, and no URL override or
local config was mounted. A direct TCP probe and JSON-RPC initialization reached
`ws://127.0.0.1:4500`. Its binary resolves to
`/home/naoto-aoki/.codex/packages/standalone/releases/0.168.0-x86_64-unknown-linux-musl/bin/codex`.
Read-only `config/read` shows a `rivault` custom Responses gateway at
`https://api.class2.llm.ai.r-ccs.riken.jp/v1/`. Remote `codex debug models` reports
`Qwen/Qwen3.6-35B-A3B` with `use_responses_lite: false`, and OpenAI `gpt-6-luna`
with that flag true. The generic `model/list` is the active catalog; its ignored
provider parameter does not establish the custom provider's capabilities.

Disposable live audits established:

- An OpenAI source turn completed. Its configured Qwen fork acknowledged the
  first turn, then failed asynchronously with the exact Hosted-vLLM
  `additional_tools` rejection and secondary LiteLLM fallback message.
- A thread-scoped localhost endpoint override captured the complete serialized
  Qwen request without logging credentials or conversation text. It contains an
  `additional_tools` item at index 1 alongside current top-level tools. A scan of
  the persisted source rollout finds `additional_tools` too. In this reproduction
  it is inherited, not newly generated by the destination's disabled Lite path.
  Its namespaces include `functions`, `clock`, and `collaboration`; current tools
  also contain declarations, so deletion or naive concatenation is insufficient.
- A fresh Qwen thread completed a response, a real `commandExecution` running
  `/bin/bash -lc 'printf FORK_AUDIT_TOOL_OK'` (exit 0, matching output), and a
  subsequent turn. The tool execution was verified in durable `thread/read`
  history, rather than inferred from assistant text or terminal notification items.
- Forking that Qwen source to OpenAI `gpt-6-luna` fails with the exact
  `input[3].content` maximum-zero error in both full-history and inclusive response
  forks. The cutoff fork durably contains one turn; the source contains three.
  Original source turn IDs remain unchanged across the audits.
- A separate thread-scoped OpenAI `openai_base_url` redirect captured serialized
  WebSocket input, including one nonempty `reasoning.content` array of
  `reasoning_text`. However its raw `input[3]` is a user message with two content
  elements, while reasoning is at index 5. This is **not** a capture at the
  production rejection boundary: redirected configuration/context and downstream
  indexing may differ. The rejected native `input[3]` type remains unverified.
  No transformation was selected on the assumption that it must be reasoning.

[Redacted runtime evidence](fixtures/cross-provider-runtime-audit.json) records
only structural metadata and audit markers. Capture endpoints intentionally
returned an audit error; those turns are not provider inference validations.
No stored inference history, process-wide defaults, or provider credentials were
changed. All ten disposable audit threads were confirmed archived after validation; both
capture listeners were closed and process-wide model/provider settings rechecked.
Both original HTTP 400s remain reproducible and unresolved. The fixture input
arrays still validate notification recovery only, not normalization.

The official [App Server documentation](https://learn.chatgpt.com/docs/app-server)
describes forks as copying stored history; it does not guarantee arbitrary
cross-provider schema compatibility.

## Smallest external compatibility change

Implement a destination-capability-aware request projection where the complete
Responses request is built in Codex, or in the LiteLLM Responses adapter before
vLLM validation. It must run after both history replay and Lite prefix generation,
on a request copy, leaving persisted history and source threads unchanged. In
the inspected reference, the first point containing replayed items **and** the
new Lite prefix is after `input.splice(0..0, prefix)` in
`codex-rs/core/src/client.rs::build_responses_request`, before constructing
`ResponsesApiRequest { input, tools, ... }`. Normalizing only
`Prompt::get_formatted_input_for_request` runs too early to catch that new prefix.
A LiteLLM adapter receiving the complete HTTP request is another valid boundary.
The frontend JSON-RPC bridge sees neither complete representation.

The runtime and route are now identified, but the deployed components' editable
implementation is not available: the Codex runtime is an installed standalone
binary outside this workspace; `/tmp/codex-search-reference` at `c0cc9fc` is an
unmatched reference checkout, not a confirmed source revision for that binary.
The hosted LiteLLM/vLLM service's source, versions and model-group mapping are not
exposed here. No guessed patch was applied to an unrelated checkout or binary.
To implement and deploy the fix, access is needed to the matching Codex 0.168.0
source/build or the deployed LiteLLM Responses adapter, its Hosted-vLLM route
configuration/capability policy, and the exact production rejection-boundary
request trace mapping `input[3]`. Local serialized captures narrow the boundary
but do not establish that downstream mapping. The existing gateway can be used
for subsequent verification once an external patch is prepared.

Required contract:

1. Capture the rejected item's actual `type`, field names and content element
   types at the destination boundary, with credentials and content redacted.
   Record effective provider/model, Codex build, LiteLLM/vLLM versions, active
   Responses Lite capability, and whether each item was replayed or generated.
2. For a destination known to reject reasoning content, normalize only that
   reasoning field to its supported representation. Preserve supported summary,
   encrypted content, messages, call IDs and tool results. If semantic state
   cannot be represented safely, return an explicit unsupported-history error.
3. For destinations lacking `additional_tools`, fold declarations into supported
   top-level `tools` before removing those input declarations. Resolve declarations
   chronologically, deduplicate by qualified identity and use current definitions
   over obsolete ones. Merge with current tools deliberately; retain definitions
   required by historical calls. Reject conflicting signatures when a single
   supported representation cannot preserve their meaning.
4. Preserve namespaces where supported. If flattening is necessary, use a stable,
   collision-free name mapping and rewrite corresponding function/custom call
   names consistently while preserving call/result IDs. Translate custom-tool
   formats only when the destination supports an equivalent representation;
   otherwise fail explicitly. Do not silently discard tools or convert arbitrary
   custom-tool payloads into function arguments.
5. Test old plus new declarations, duplicates/overrides, namespaces with colliding
   leaf names, custom tools, orphan detection, new Lite-generated declarations,
   mixed reasoning, and same-provider no-op behavior. Verify a completed response,
   tool-call/result round trip and subsequent turn, not just `thread/fork` success.

Disabling Responses Lite in a **destination's** model capabilities may address
newly generated declarations on affected Codex versions. It does not establish
that inherited declarations or reasoning are safe. Do not change process-wide
provider defaults or patch rollout files as a workaround. Native cross-provider
compatibility remains dependent on the external implementation above.

## Recovery without native compatibility

Open the prefix draft identified in the error (`#/thread/<id>`) and explicitly
choose another provider/model, inspecting the failed child for output and tool
effects before sending. For a response fork the retained prefix still ends at
that response, even when later source turns exist.

The application has **no implemented portable-context transfer workflow**. The
following is a manual workaround, not a feature or a compatibility fix.

If no compatible native destination exists, start a new chat with the desired
provider/model using the normal new-chat screen. Copy only the intended readable
user/assistant prefix into its first message under `Transferred conversation
context`, then add the new request. This is a **readable context transfer**, not
an exact fork: structured reasoning, encrypted state, call/result associations,
tool definitions and tool execution state are lost. Review tool observations as
quoted context; they do not assert that tools ran in the destination. A fresh
thread may still fail if the destination's newly generated tool format is
unsupported; that requires the external change above too.

## Performance audit

Normal fork creation/submission and thread loading add no RPCs. Reconnect reuses
the selected history read and additionally reads each background tracked fork
once, serially, alongside the sidebar refresh. It deduplicates the selected ID;
there is at most one recovery history read in flight, with no unbounded fanout.
Turn status normalization is linear in the already returned (capped) turn page,
without copying conversation content or making a second request. An idle snapshot
cannot invalidate completion ownership. Existing history-read/realtime revision
and lifecycle guards prevent stale snapshots from settling newer attempts.

Tracking uses constant-time maps per participating thread/storage key and a
maximum of 16 early outcomes per tracker. Recovery serializes only the submission
payload and writes at most two copies (child plus prefix alias); it never scans persisted inference history. Composer settlement adds no
network work and suppresses duplicate clicks while awaiting acceptance. Archive
is issued once only for an owned, unused prefix after confirmed success. No
filesystem scans, process-default changes or new inference requests are added.
Live provider latency was not benchmarked; the live audit measured outcomes and
structure rather than performance.

Verification: mounted SFC tests execute the actual template/form with Vue's host
renderer. A Playwright harness at
`http://127.0.0.1:4173/fork-review-composer`, viewport 1280x850, mounts the real
composer with a controlled rejection callback. It verifies text, image/file/skill
retention and post-refresh persistence in light/dark themes. Browser Use was
unavailable; Playwright supplies the controlled harness. This is component UI
validation, not a running-provider or full-App acceptance test. Artifacts under
`output/playwright/`: `fork-review-composer-light.png`,
`fork-review-composer-dark.png`, `fork-review-composer-refresh.png`.
