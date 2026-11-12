# Native capability consolidation

## Verified baseline

The dependency is Codex CLI 0.167.2. Its actual executable generated the inspected
schemas with `node_modules/.bin/codex app-server generate-json-schema --out /tmp/codex-schema`.
Upstream implementation inspected at tag `rust-v0.167.2`:

- [Thread section request processor](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/app-server/src/request_processors/thread_sections.rs)
- [Built-in Pinned section constants](https://github.com/openai/codex/blob/rust-v0.167.2/codex-rs/state/src/lib.rs)

Native sections require durable local state support. Schema availability does not
guarantee a particular external deployment supports the operation.

## Removed features

Saved Markdown prompt CRUD, insertion and HTTP endpoints are removed. No prompt
files are deleted or converted. Skills discovery, configuration, selection and
invocation remain; the generated-prompt Skill Try workflow is removed.

Automatic Git worktree creation, rollback cleanup, runtime picker and starting-branch
selection are removed. Select existing directories, including existing worktrees,
through the folder picker. Existing conversations keep their cwd.

Thread titles come from native `thread.name`, with `thread/name/set` for renaming
and `thread/name/updated` notifications. The separate title cache and disabled
session_index.jsonl fallback are removed. Old global-state title fields are left
untouched but never read or written.

Unused session history enrichment and local session metadata parsers are removed.
History comes from native `thread/read`, with inline media sanitization and sparse
attachment-only recovery retained. The native Turn schema alone cannot establish
historical per-turn model/reasoning values. The current app-owned metadata store
preserves submitted values and execution evidence separately, including best-effort
fork inheritance; see [generation metadata](../turn-generation-metadata.md). Legacy
files remain untouched unless explicitly enabled for compatible migration.

The application no longer accepts --login, --no-login, --memories, --no-memories,
--sandbox-mode or --approval-policy. Configure server defaults in Codex; supported
web startup flags and native per-thread permissions remain.

## Native pins and migration

Pins use `thread/section/move` with Codex's built-in Pinned section ID
`01984de2-8f74-7c91-a3b2-5c5e937cf318`; unpin sends sectionId null.
GET `/codex-api/thread-pins` is a thin native paginated read plus a one-time legacy
migration adapter. It does not store new pin state. The old PUT contract is removed.
New pins use beforeThreadId to preserve top insertion. Acknowledged moves update the UI without a duplicate list request; section notifications and reconnect reload native membership. The sparse history
index delegates section-filtered listing directly to Codex so it cannot inject
unsectioned rows or reorder results.

Legacy pinned-thread-ids are moved serially, then only that field is removed from
the shared global-state object. Failure retains legacy state for idempotent retry;
other fields and files are preserved. Unsupported servers cannot change pins and
must be upgraded; no second writable pin store is maintained. Pinning replaces a
thread's section, consistent with native single-section semantics.

## Intentionally retained adapters

- Workspace folder registry: saved empty directories, labels, visibility and sidebar
  ordering cannot be reconstructed from native conversation cwd. Remote records
  also preserve existing project associations. Identity-only normalization around
  reads/writes is removed; no server-host realpath is applied to remote paths.
- Sparse attachment-only first-turn index and pending-send recovery: preserve
  otherwise omitted conversations and prevent duplicate sends after ambiguous
  transport outcomes. This is separate from deleted session enrichment.
- Browser transport, attachments, auth, approvals, search, read receipts, model and
  reasoning settings, Plan mode, Goals, Skills and MCP adapters remain necessary
  to expose Codex in a browser.

## Request costs

Native pin reads paginate serially at 100 rows per request; legacy migration makes
one move per legacy ID without scanning history. Section-filtered listing bypasses
custom history reconciliation. Pin storage introduces no separate writable store
or background polling. Cross-client behavior requires live deployment verification.

## Verification boundaries

Use [workspace acceptance tests](../../tests/projects-sidebar-new-chat/native-workspace-workflows.md),
[development checks](../development.md) and the
[external-server procedure](../../tests/website-docs-misc/external-app-server.md).
Credential-free fixtures verify protocol/entry points, not authenticated turns,
approvals or durable cross-client pins. Generated schemas establish available
shapes, not deployment capability. Remaining verification work is tracked in
[open items](../maintenance/open-items.md).
