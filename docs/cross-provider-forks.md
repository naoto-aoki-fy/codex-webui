# Cross-provider forks and recovery

## Current boundary

The web application connects to an independently managed Codex app-server over
JSON-RPC. It does not construct the model's HTTP Responses request. The installed
`@openai/codex` development dependency is pinned to 0.167.2; it does not determine
the version of that independently running server. `pnpm exec codex --version`
reported `codex-cli 0.167.2` locally; no independent server version was observed.

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
A second submission is blocked while the first outcome remains pending.

On failure the error identifies the retained prefix route. The submitted prompt,
image references, skill references and file attachments are retained in separate
profile-scoped browser recovery storage while inference is pending. Its composer
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
Nonempty `reasoning.content` is a plausible cause, represented by the regression
fixture, but this user's request was not captured. Clearing all arrays or removing
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

No independently managed app-server was running in the investigation environment.
No outgoing inference request, deployed Codex version, LiteLLM version, vLLM
version, completed live response or live tool round trip was captured. Unit and
integration fixtures are credential-free protocol checks, not provider validation.
The official [App Server documentation](https://learn.chatgpt.com/docs/app-server)
describes forks as copying stored history; it does not guarantee arbitrary
cross-provider schema compatibility.

## Smallest external compatibility change

Implement a destination-capability-aware request projection where the complete
Responses request is built in Codex, or in the LiteLLM Responses adapter before
vLLM validation. It must run after both history replay and Lite prefix generation,
on a request copy, leaving persisted history and source threads unchanged.

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

The change adds no RPCs during configuration, thread loading or submission.
Archive moves from acknowledgment to confirmed completion (one request per
successful configured fork). Tracking is constant-time map access by thread/turn;
early terminal buffering is capped at 16 events per pending fork, with no history
copy or request fanout. Pending recovery serializes the submitted prompt/attachments to browser storage,
with size proportional to that submission, not conversation history. Submission
also checks for an existing recovery payload with one synchronous storage read;
failure may additionally restore ordinary composer storage. No cache invalidation or blocking filesystem scan is added.
Retained drafts intentionally remain after failures or missed notifications;
manual cleanup may be needed. Live latency and browser rendering were not measured.
