# Maintenance cleanup status

## Scope and status

| Item | Status | Result |
| --- | --- | --- |
| 1 | Completed | Repository-status implementation, gateway, sidebar props/events/watchers and obsolete tests removed. Retired URL returns JSON 404. Other Git/diff functionality retained. |
| 2 | Completed | Unused local command, command-resolution and invocation modules/tests removed; no production callers remained. Remote filesystem/search operations remain. |
| 3 | Completed | Unreachable custom list merger, synthetic cursors, list-triggered reconciliation, unused recovery entry point and legacy list callback removed. Durable attachment-only submission intent, exact acceptance checks, pending state, locks and lifecycle updates remain. Production thread lists already bypassed this merger. Imported content remains owned by conversation transfer. |
| 4 | Completed | Standalone 0.168.0 adapter, patch, Rust manifest/lockfile, probes, fixtures, tests and deployment guide removed. No runtime or package integration used them. Native providers/forks remain. |
| 7 | Completed | Persistent fresh-fork registry, provider-triggered second fork, first-turn tracking, special recovery writes, replacement routing and prefix auto-archive removed. Ordinary drafts, ambiguous-send protection, Portable Fork and Fork and Revert remain. The composer retains read-only recovery of old saved drafts. |
| 8 | Completed | Runtime metadata store, request/response recording hooks and acceptance metadata callback removed. Existing metadata stores are neither deleted nor relabeled. Persistent rollout cache remains. |
| 10 | Partially completed | Source-to-fork copying and matching removed; each fork uses its own rollout cache. Fixture coverage passes. Actual live fork/revert rollout behavior remains unverified: the bounded live sample did not contain a source with two readable turns. |
| 11 | Partially completed | API inspection and read-only runtime probe completed; migration NOT implemented. The pinned 0.167.2 generator exposes project list/read/create/import/update/move/delete and native thread project IDs. The connected 0.169.0 server successfully returned six projects. API absence is NOT a blocker on that server. A complete migration of the current path-keyed registry/UI, ordering and associations remains required before retiring its storage. |
| 12 | Blocked by item 11 | Path grouping retained to preserve current behavior. Cwd/execution information remains intact. |
| 13 | Completed | Unsupported refresh has no success branch, credential callback or single-flight promise; the originating server request receives error -32001. Other authentication/approval paths remain. |
| 14 | Completed review; fallback retained | Native structured responses are used first. The narrow unknown-plan decode-error recovery remains for existing external deployments: no enforced minimum server version proves all supported endpoints decode these quota payloads natively. Removal needs an explicit runtime compatibility floor and native coverage, not only generated type availability. |
| 15 | Completed | DTOs and backend imports share generated 0.167.2 types. Old unversioned TS/JSON snapshots removed. Version-checked generator reproduces retained types and method/notification catalog. No dependency upgrade. |
| 16 | Completed | dev2 alias/shim, packaged shim entry and unpacked debug launcher removed. Normal dev/build/test commands remain. |
| 17 | Partially completed | Tests/manual procedures and architecture docs updated. Project-migration tests do not exist because migration is not implemented. Full live authentication, provider turns and fork/revert/browser acceptance remain unverified. |

This is a partial completion of the requested scope, not a completed Project API
migration. Existing projects, native projects and old application stores have not
been migrated, deleted or rewritten. Before switching storage, native IDs must be
propagated through the gateway/sidebar/new-thread path and migration must prove
repeatable preservation of empty projects, labels, ordering and membership,
including coexistence with already-created native projects.

## Historical metadata and compatibility

See the exact [rollout/cache/normalization path](turn-generation-metadata.md).
The persistent cache is on the App Server host at
`<CODEX_HOME>/cache/model-history/v1/<sha256(threadId)>.json`. It validates source
path and modification time and reuses valid data across backend restarts. The
shared metadata value/parser/merge/label module remains. No original rollout is
modified, and old `codexapp-turn-metadata` stores remain untouched and unread.
Native fork/revert histories without matching native context rows show unknown
metadata, without losing content. No source-thread settings are copied.

No user migration command is required for this cleanup. The retired dev2 alias
must be replaced by `pnpm run dev`. The removed external adapter is no longer a
supported deployment workflow. Remote capability availability remains a runtime
requirement; 0.167.2 is the reproducible build-time protocol baseline, not an
assertion that every experimental method is available on every server.

## Validation and performance evidence

- Baseline: `pnpm run test:unit`: 99 files / 1,329 tests passed, one skipped.
- Final: `pnpm run test:unit`: 90 files / 1,268 tests passed, one skipped. Removed
  cases covered deleted helpers, custom list merging, adapter and metadata
  recording/inheritance. Retained fork/transfer/revert, imports, attachment journal,
  drafts, ambiguous sends, authentication and approval tests pass.
- `pnpm run typecheck`: passed (Vue/frontend and server TypeScript).
- `pnpm run build`: passed (frontend, precompression and ESM CLI).
- `pnpm run test:integration:fixture`: passed for built CLI and development server,
  including retired endpoint JSON 404s, HTTP RPC, metadata, browser WebSocket,
  single initialization and independent fixture process survival.
- CJS entry smoke: `node -e "const {execFileSync}=require('node:child_process');
  const out=execFileSync(process.execPath,['dist-cli/index.js','--help'],
  {encoding:'utf8'}); if(!out.includes('Usage:')) throw new Error('Missing CLI help');"`
  passed. There are no public CJS exports; the CJS harness launches the public ESM
  CLI, as does the integration fixture.
- `pnpm run generate:project-file-protocol`: repeated generation produced identical
  hashes for 160 retained type files and the method catalog (161 files total).
  Codex emitted a harmless read-only stale-temp cleanup warning; generation passed.
- `git diff --check`: passed.

Concrete code-path audit: repository checks now issue zero Git-status filesystem
or command RPCs. Fork metadata copying issues zero source-history RPCs; cutoff
validation still reads one source snapshot for correctness. Send metadata
recording performs zero metadata-store writes and adds zero RPCs. Rollout recovery
retains one serialized source transfer, 16 queued/coalesced threads, bounded
payloads and timestamp validation. The cold/restart fixture asserts seven cold
RPCs, three warm RPCs and only one original-rollout transfer; append and explicit
refresh invalidate correctly. No synchronous source reads, session traversal or
new unbounded fanout were added. Sparse attachment intent remains durable.

Current build output is approximately 383 kB for the main JS chunk and 187 kB for
the ESM CLI (uncompressed). No baseline bundle comparison or live render/latency
measurement was made. No browser automation/theme screenshots were run; the
cleanup removes obsolete UI wiring and notices without adding visual controls.

Read-only live probe: initialization reported `codex-web-local/0.169.0`; native
`project/list` succeeded. A fork rollout probe inspected at most five of ten
listed threads and found no source with two readable turns. It created no fork,
sent no model request and changed no source conversation. Fixture tests are not
substitutes for live fork/provider/authentication acceptance.
