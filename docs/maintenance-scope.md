# Maintenance scope

The application is a Node.js CLI server and browser UI for Codex app-server. Supported hosts are Windows and Linux; mobile browsers can connect to those hosts.

## Supported workflows

- `package.json` defines frontend/CLI builds, unit tests, and development commands.

## Retired material

`ProxySpec.md` described removed OpenRouter, Zen, and custom proxy modules. Current authentication/model behavior is covered by `tests/providers-models/codex-only-models-and-auth.md`. Legacy provider fixtures that test history and preference migration remain relevant.

The Codex.app thread-filter and worktree-button patch scripts, their macOS launcher, and their manual procedures were removed. They patched a separate Electron application using version-specific internals and were not used by the application, package scripts, or CI. The unpacked debug launcher and unused compatibility alias were also removed.

The old CLI auto-star procedure was removed because the current CLI has no repository-star behavior. The documentation website now describes this repository instead of a separate OpenClaw Android APK product.

Historical source material under `llm-wiki/raw/` and generated upstream protocol documentation remain intact. They serve as evidence and protocol references, rather than current setup instructions.

## Outstanding work and tooling boundaries

[Open items](maintenance/open-items.md) is the canonical list of verified concerns
and deferred decisions, including portable profiler inputs.

## Medium-risk cleanup boundaries

The scoped review of items 06/07/10/11/14/19 starts at `441d75b`.
It preserves historical generation metadata, Portable Fork, send recovery,
Project/pin upgrade guards and native capability support.

### Obsolete presentation (06)

Removed only CSS from the retired runtime toggle, automatic-worktree status,
project-creation modal and old plugin/app Directory cards, tabs and modals.
The producers were deleted in `478b0a4`, `f6522cb` and `98317c8`. Inspection of
current templates, dynamic class bindings, Directory badge helpers, generated
Markdown classes and router imports found no producer for those selectors.
No active factory constructs these class prefixes. They do not supply shared
variables or animation names. Active folder-picker selectors and shared Directory
heading/loading/action rules remain, including the used part of grouped rules.
Skills/MCP conditional badges use `mcp-skill-badge-*`, not old Directory badges.

### API boundary (07)

One final API-prefix handler returns JSON 404 for unrecognized paths and wrong
methods, before either development or production SPA fallback. Existing explicit
contracts such as thread-index rebuild (501) and external-account login guidance
(409) remain ahead of it. Authentication middleware ordering is unchanged.
The old per-endpoint 404 list is redundant with this handler.

The unused `generate-thread-title` success stub is removed. RPC misses follow the
external server's correlated error path and existing HTTP 502 mapping; they never
become successful empty titles. Native title reads, rename and notifications are
unchanged. Old cached clients receive a structured error. Old account-login POSTs
still receive the actionable external authentication/reconnect instruction.

This adds no RPC for an HTTP miss: one prefix check replaces a route-name list.
RPC forwarding still uses one existing request and its ID. No new scan, fanout,
large payload, retry, cache or invalidation path is introduced. No live latency
improvement is claimed.

### Retained compatibility (10 and 11)

Rate-limit recovery is retained. Its exact trigger is an upstream quota decoder
error containing `unknown variant`, `plan_type` and `body=`. It extracts usable
quota windows/credits from the embedded JSON body, only for
`account/rateLimits/read`; other errors propagate. The fixture models a previously
unrecognized `prolite` subscription. Current generated types include that value,
but neither generated 0.167.2 types nor one successful runtime call proves that
all supported quota endpoints accept every subscription value. The supported
runtime floor remains [0.169.0 plus required capabilities](native-project-migration.md).
No enforced quota-schema compatibility guarantee justifies deleting recovery.
Eventual removal needs runtime/backend evidence covering the supported range,
including unknown plan values, not only synthetic success.

`public/sw.js` is already a minimal retirement mechanism. The PWA began in
`ac1eab3`; subsequent workers cached shell/assets, and `74ea66a` retired them.
`src/main.ts` no longer registers workers and has no page-side storage purge.
The retirement script claims clients, removes only `codexweb-shell-*` and
`codexweb-assets-*`, and unregisters. It has no fetch handler or forced reload.
No supported migration cutoff establishes that all old browsers have updated.
Keep this URL serving JavaScript until an explicit supported upgrade policy can
exclude every old registration. The isolated-browser upgrade procedure is in
[the existing cache checklist](../tests/website-docs-misc/cache-first-hashed-assets.md).

### Skills capability inventory (19)

| Capability | Dedicated `/skills` route | Composer |
| --- | --- | --- |
| Listing | Installed native skill catalog, including disabled entries | Enabled skill options |
| Search | No dedicated skill search control | Searchable picker and slash suggestions |
| Details | Description and rendered SKILL.md modal | Selected chip opens SKILL.md through file browsing |
| Conversation reference | No insertion action | Select/remove chips; submit native skill references |
| Enable/disable | `skills/config/write` by native path, then catalog refresh | No management action; disabled skills excluded |
| Persistence/scope | Native App Server configuration, path-based; no new browser skill registry | Conversation selection, not enable/disable configuration |
| No active conversation | Sidebar and direct route remain usable | No equivalent management entry point |
| Other native controls | MCP status/details/reload/OAuth | No matching management workflow |

The screen cannot be removed without losing management, disabled-skill discovery,
standalone access and MCP controls. Moving these into the Composer would require
more than a small replacement. Item 19 is deferred; no partial screen deletion
or redirect is introduced. Native configuration scope remains the server's
existing `skills/config/write` contract; no extra scope selector is implied.

### Docker validation boundary (14)

The fast runner remains supported by repository instructions; it is not wired
into package scripts or CI. It now requires an explicitly managed external test
endpoint rather than an unconfigured local Codex executable. See
[development setup](development.md#optional-docker-feature-checks) and
[container acceptance](../tests/auth-docker-runtime/fast-external-server.md).
Docker daemon execution must still pass on a Docker-enabled host; shell syntax
and the non-container protocol fixture do not establish container acceptance.
