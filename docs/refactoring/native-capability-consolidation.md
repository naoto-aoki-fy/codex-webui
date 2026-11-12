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

Unused session history enrichment, local session metadata parsing and fork metadata
inheritance are removed after verifying no runtime consumers. The generation
metadata JSONL store had an active writer but no active reader; disk writes and
unused recovery are removed. Submitted model/reasoning values remain attached to
live turns in memory. The 0.167.2 Turn schema has no historical per-turn model or
reasoning fields, so reopened history cannot truthfully show those values. This
matches the prior active read path; no thread defaults are presented as execution
evidence. Existing metadata files remain untouched.

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

## Performance audit

Code-path analysis: removes composer prompt fetches, title-cache requests,
per-turn metadata disk appends, worktree branch requests and creation commands,
plus unused parsers/caches. Workspace mutations avoid repeated identity-only
promise traversals. Native pin reads paginate serially at 100 rows per request;
legacy migration makes one move per legacy ID and never scans history. Section
listing bypasses custom history reconciliation. No new background polling or
custom persistence is introduced. Live server latency and cross-client behavior
require an independently authenticated server and were not measured here.

## Verification

- Full unit suite: 79 files passed, one live test skipped; 1,130 tests passed.
- The final focused gateway suite passed 30 tests, including native pin ordering/unpin payloads.
- Type checking and production build passed. No lint script is configured.
- Credential-free external-server fixture passed for development and built CLI:
  removed HTTP routes return JSON 404; RPC, metadata and browser WebSocket share
  one upstream connection. The independently managed fixture survives shutdown.
- ESM package entry smoke check (there is no public CJS export):
  `node -e "process.argv = ['node', 'dist-cli/index.js', '--help']; import('./dist-cli/index.js')"`
  exits 0 and prints supported options. Removed flags fail with unknown-option errors.
- Playwright fixture checks at 1280x900: `http://127.0.0.1:4173/#/?cwd=/tmp`
  and `http://127.0.0.1:4173/#/skills`; selected native Skill chip and configuration
  remain, prompt CRUD/Try/worktree creation are absent, light/dark surfaces render,
  and no page runtime errors occur. Evidence is under `output/playwright/`:
  `native-cleanup-home-light.png`, `native-cleanup-home-dark.png`,
  `native-cleanup-skill-light.png`, `native-cleanup-skill-dark.png`.
- Browser Use was unavailable. Playwright Chromium was downloaded under `/tmp`;
  initial missing-browser and strict-selector failures were corrected and rerun.
- No live authenticated Codex turns, approval flow, durable cross-client pin
  synchronization or real-user workspace mutation was performed. These remain
  deployment checks; protocol fixture results are not live server evidence.
