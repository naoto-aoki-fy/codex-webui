# RiVault and OpenAI-compatible model catalogs

## Diagnosis and evidence

RiVault reported `Hosted_vllmException: Custom tools with a grammar format are
not supported; only free-form text custom tools are accepted. (parameter=tools)`
when selecting `Qwen/Qwen3.6-35B-A3B`. This identifies a rejected tool declaration;
it does not establish a problem with persisted conversation history. A fresh
thread can also advertise unsupported tools. LiteLLM fallback routing does not
make an unsupported tool schema compatible.

The operator reports success using a `/v1/models` to Codex catalog adapter with
these model metadata fields:

```json
{"tool_mode":"direct","apply_patch_tool_type":null,"shell_type":"unified_exec"}
```

This is an operator-reported workaround, not an independently reproduced RiVault
inference result. The Python attachment was unavailable during this investigation;
only the supplied fields could be assessed. No line-by-line adapter audit or
adapter conversion test is claimed.

The following mechanisms are established by official Codex `rust-v0.168.0` source:

| Setting | Effect and limits |
| --- | --- |
| `apply_patch_tool_type: null` | The [tool planner](https://github.com/openai/codex/blob/rust-v0.168.0/codex-rs/core/src/tools/spec_plan.rs) registers the dedicated patch handler only when this field is present/non-null. The [patch tool spec](https://github.com/openai/codex/blob/rust-v0.168.0/codex-rs/core/src/tools/handlers/apply_patch_spec.rs) uses a custom tool with `format.type = "grammar"`, syntax `lark`. Even `"freeform"` metadata produces a grammar declaration. Null removes this dedicated tool; it does not disable all shell-based editing. |
| `tool_mode: "direct"` | [Mode selection](https://github.com/openai/codex/blob/rust-v0.168.0/codex-rs/core/src/tools/mod.rs) uses explicit model metadata ahead of code-mode feature defaults. The [code-mode execution spec](https://github.com/openai/codex/blob/rust-v0.168.0/codex-rs/core/src/tools/code_mode/execute_spec.rs) also declares a Lark grammar. Direct mode avoids that code-mode wrapper but does not remove the dedicated patch tool. |
| `shell_type: "unified_exec"` | Compatible with Codex's function-based command tools. In the inspected planner, shell feature/policy gates choose resumable versus one-shot execution; this value alone is not a general grammar filter. |

Both the first and second settings plausibly explain the fix. Which was necessary
in the failing environment is unresolved without its effective metadata, enabled
features, Codex version, and failed request's tool inventory. Other registered
custom tools can still declare grammars. Successful text generation alone cannot
verify tool compatibility.

## Existing application boundary

`src/api/codexGateway.ts` discovers providers through the connected app-server
and reads each catalog with native `model/list` requests, explicitly setting
`modelProvider` on every page (Codex CLI 0.169.0). Discovery includes hidden models
for saved-selection capabilities and preserves native display/reasoning metadata.
It never executes a catalog command. Tool metadata and instruction templates
remain on the external server. Provider-qualified selections keep identical model
IDs separate; thread creation/fork sends the provider and raw model, and turns
send the raw model on the existing thread.

Configure catalogs on the independently managed Codex host, using that host's
user, PATH and CODEX_HOME. Keep its provider ID, inference base URL, credentials,
and model ID intact. The provider-scoped configuration is:

```toml
# Add only to the existing provider entry; leave its other fields unchanged.
[model_providers.rivault]
model_catalog_url = "http://127.0.0.1:8061/codex/models"
```

The URL is illustrative: use the actual separately managed service address as
seen from the external app-server. It must return a complete Codex catalog for
the deployed version, not just the three fields above or a raw `/v1/models` list.
Refresh discovery after configuration changes; verify picker metadata with
`model/list` using `modelProvider: "rivault"` and `includeHidden: true`. Do not assume a
picker refresh invalidates all app-server model caches or updates loaded threads.

Native provider-scoped discovery targets Codex CLI 0.169.0. The older checked-in
protocol snapshot is extended by the application ModelListParams DTO; unrelated
filesystem protocol tooling remains pinned to 0.167.2. The tool-planning assessment above is
specifically for 0.168.0, not a guarantee across versions. Check the exact deployed
CLI and app-server versions and their catalog schema before deployment.

[Native Fork and Portable Transfer](cross-provider-forks.md) keep their current
semantics. The retired external history projection
retains current top-level tool definitions, including custom formats; it cannot
resolve this error by itself. No turn rewriting, automatic retry, provider-default
change, or global tool disabling is needed in the web application.

## Adapter recommendation and review requirements

Keep the adapter independently managed for now. A second catalog implementation
inside this application is not justified without the missing source and a tested
Codex-version contract. The existing provider `model_catalog_url` is the extension
point. Python is not required by this application, and it must not launch a proxy.
A future optional utility should satisfy these requirements before inclusion:

- Validate HTTP status, bounded response size, JSON shape, unique nonempty model
  IDs, and timeouts. Convert `data[].id` to `models[].slug` without aliases,
  provider reassignment, or silent model replacement.
- Use a minimal version-tested schema for unknown models. Do not infer context
  windows, vision, Responses Lite, tool search, or reasoning support from names.
  Advertise reasoning efforts only when explicitly supported; do not invent
  `low`/`medium`/`high` merely to fill a selector.
- Do not clone capabilities/instruction templates from a matching OpenAI model.
  Matching slugs or prefixes do not imply matching provider capabilities. Preserve
  explicitly configured capabilities and document override precedence. Validate
  the final merged record: an override restoring `freeform` patch or code mode
  must be an explicit opt-in with a warning/error for a no-grammar profile.
- Do not run `codex debug models` inside a catalog request. If that CLI uses this
  same catalog URL, requests recurse. Use explicit, versioned schema/templates
  and fetch the upstream `/v1/models` directly; reject a self-referencing URL.
- On upstream failure or malformed data, report failure. Never silently return an
  OpenAI catalog. If stale data is intentionally supported, bound its age, scope
  it by upstream/provider/configuration, expose its stale status, and invalidate
  it when overrides or identity change. Codex may have its own caches as well.
- Test conversion, unknown models, override precedence, unsafe matching metadata,
  unavailable/malformed upstream responses, stale data, and identity preservation
  without credentials. Then verify the emitted tool inventory with the intended
  Codex release. Catalog conversion tests alone do not establish tool execution.

## Verification scope and performance

Credential-free repository tests cover catalog normalization, metadata isolation,
unknown-model reasoning defaults, rejection of raw OpenAI catalog shapes, malformed
or failed remote catalog commands, provider identity, switching back to an
existing OpenAI thread after RiVault selection, and propagation of the grammar
error without retry. They simulate JSON-RPC and do not test the missing Python
adapter, actual Codex tool planning, or RiVault inference.

No production code, requests, payloads, caches, module loading, or rendering paths
change. Thus there is no runtime performance impact from these documentation and
regression additions; live provider latency and tool execution were not measured.
See the [manual matrix](../tests/providers-models/rivault-tool-compatibility.md)
for the remaining provider checks, including a controlled setting comparison.
