# R1–R9 implementation and verification

This is a historical verification record. Current operational behavior is documented
in the [external server guide](external-app-server.md).

This change revalidated the historical v0.1.87 findings against the current branch.
All implementation remains on the existing `main` branch. No publication, deployment,
merge, production disconnect, or deletion of existing uploads was performed.

## Status and evidence

“Verified” below means deterministic/unit, local WebSocket/HTTP fixtures or browser
fault injection. No authenticated two-host server verification is claimed.

| Item | Status | Change and evidence | Remaining boundary |
| --- | --- | --- | --- |
| R1 | Implemented and fixture verified | Backend scheduler owns auto/manual resume, coalesces jobs, invalidates stale work; UI preserves drafts/content, shows per-thread status and refreshes recovered history. Scheduler, RPC lifecycle and desktop-state regressions cover transient/persistent failures, manual retry, notification delivery and deduplication. | Live authenticated recovery needs two-host verification. |
| R2 | Implemented and fixture verified | Three independent workers; four attempts, 5-second deadline, 30-second elapsed budget, exponential backoff outside workers. Fake-clock tests cover a silent thread, healthy threads/RPC, disconnect cancellation and late work. | Caller deadlines do not cancel upstream operations. |
| R3 | Implemented and fixture verified | Observed supported/unsupported/unknown evidence, read-only diagnostics, workflow requirements, specific metadata failure guidance; classifier and actual local WebSocket fixtures distinguish -32601, ENOENT, EACCES, transport and incompatible responses. | Initialize has no authoritative method map; unobserved writes remain unknown. Optional failures do not block conversation. |
| R4 | Implemented and fixture verified | Separate transport/recovery/approval/uncertainty UI; stale approval handles rejected; HTTP/network lost-response regressions preserve uncertainty; no mutation replay. Browser fixtures exercise status and history actions in both themes. | Approval re-delivery depends on actual upstream behavior. Missing history cannot establish failed submission. |
| R5 | Implemented and reviewed | External-server guide and domain checklists cover topology, actual routes, configuration, migration, tunnel/OAuth, recovery and storage limits. | Two-host checklist remains manual. |
| R6 | Implemented and verified on Linux | Shared remote lexical path rules preserve drive/UNC forms and nested Skills grouping. Focused filesystem/browse/Skills tests cover trailing separators, siblings and POSIX. | Native Windows host execution was not run. |
| R7 | Implemented and fixture verified | Coalesced bounded file reads/cache, metadata conditionals and native history cursors. The CLI and dev fixture verifies one native RPC per earlier page. | No ranged fs/readFile. Cold HEAD/ETag/Range transfer the whole file. Explicit response fork verification and Portable Fork can transfer full history. Fixture timings are not WAN timings. |
| R8 | Implemented and fixture verified | Explicit named machine identity partitions workspace/presentation/thread metadata/index state; legacy remains exclusively legacy with locked atomic persistence. Same forwarding URL profile tests preserve separate roots. Browser remote state and drafts are profile scoped. | Restart A when switching machine/profile; do not silently repoint a running profile. |
| R9 | Partially implemented with a specific blocker | Shared tracked-attempt inventory, legacy import, 1 GiB default capacity reservations, 80% warning, inspectable settings/API, protected records and empty cleanup preview. Disposable fixtures verify shared capacity and no deletion. | Complete cross-profile/client reference and submission proof is unavailable. Safe automated cleanup cannot be authorized; all uploads remain protected, no deletion endpoint exists. Operator-assisted audit is documented. |

## Current configuration

Start the backend with an explicit App Server ID and configure a dedicated
absolute path on the App Server for uploads. See the
[current storage and upload guide](connection-profiles-uploads.md) and the
[deployment and recovery guide](external-app-server.md). The verification
results below describe the implementation tested on their stated dates.

## Commands and outcomes

Final integrated results (2026-11-13):

| Exact command | Outcome |
| --- | --- |
| `pnpm run typecheck` | Passed frontend vue-tsc and server tsc. |
| `pnpm run test:unit` | 88 suites passed, 1 skipped; 1,219 tests passed, 1 skipped (credential-gated project-files live test). |
| `pnpm run build` | Passed frontend/Vite and CLI/tsup; CLI 187.11 kB, main browser JS 384.02 kB / 126.64 kB gzip. |
| `pnpm run test:integration:fixture` | Passed built and dev entry points over WebSocket; one initialize each, independent listener survives shutdown. |
| `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture` | Passed the same built/dev checks over a disposable Unix socket. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright node scripts/test-recovery-status.cjs` | Passed all recovery/diagnostic/inventory/draft checks in light and dark. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright node scripts/test-connection-profiles.cjs` | Passed profile reload, colliding-ID draft isolation/restoration and same-profile no-reload in light and dark. |
| `pnpm exec vitest run src/server/remoteTransfers.benchmark.test.ts --reporter=verbose --disableConsoleIntercept` | Passed; measurements below. |
| `git diff --check` | Passed. |

Public CLI smoke from a CJS caller (the package exposes an ESM executable, no
public CJS export):

```sh
node -e "const {execFileSync}=require('node:child_process'); const assert=require('node:assert/strict'); const help=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'}); assert.match(help,/--connection-profile/); assert.match(help,/--app-server-url/); console.log('CJS caller -> public ESM CLI: profile and endpoint flags verified')"
```

Passed with the stated profile/endpoint confirmation. No dependency, lockfile or
hook bypass was used. Live credentials, real two-host streaming/approvals, native
Windows execution, MCP provider OAuth and WAN/peak-RSS measurements were not run.
The first broad test run exposed obsolete lifecycle mocks (including a resume mock
that fell through to a local listener) and expected error wording. Those fixtures
were corrected to isolate transport and assert the current behavior; checks were
not disabled and dependency policies were unchanged.

Browser verification uses Playwright because synthetic network failures and page
state injection require request interception/page-context mutation. Command:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright node scripts/test-recovery-status.cjs
```

Passed at `http://127.0.0.1:4173/#/thread/recovery-fixture`, viewport 1440×1000:
recovering/recovered/failed subscriptions, manual retry, disconnected transport,
expired approval, uncertain submission, draft preservation, compatibility evidence
and upload inventory. Light and dark screenshots:
`output/playwright/recovery-status-light.png` and
`output/playwright/recovery-status-dark.png`. Browser installation used `/tmp`;
no package/lockfile policy changes were needed. Verification server 4173 remains
running; persistent 5173 was not stopped.

Profile browser URL: `http://127.0.0.1:4173/?connection-profile=legacy#/thread/shared-profile-thread`,
viewport 1440×1000. Passed after actual document reloads and return to legacy.
Screenshots (absolute workspace paths, generated artifacts are untracked):

![Recovery light](/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/recovery-status-light.png)
![Recovery dark](/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/recovery-status-dark.png)
![Profile isolation light](/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/connection-profiles-light.png)
![Profile isolation dark](/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/connection-profiles-dark.png)

## Benchmark interpretation

Representative synthetic 2 ms/RPC fixture measurements:

| Workload | Historical-path baseline | Implemented path |
| --- | --- | --- |
| Five 8 MiB file accesses | 10 RPCs; 55,924,575 bytes; 226.8 ms | 6 RPCs; 11,185,259 bytes; 52.8 ms |
| 1,000 × 4 KiB turns, four pages | 4 RPCs; 16,715,704 bytes; 63.4 ms | 6 RPCs; 241,227 bytes; 16.5 ms |

Retained cache occupancy: 8,388,608 file bytes and 23,927 history-index bytes.
This measures response JSON bytes/cache occupancy; it does not measure peak RSS,
real WAN latency or authenticated server throughput. Native indexing increases
small request count while substantially reducing item payloads. Exact reproduction
and protocol schema generation commands are in the benchmark document.

## Outstanding live checks

Follow [the two-host checklist](../tests/website-docs-misc/external-app-server.md#two-host-ssh-tunnel-ownership-and-recovery-smoke-test)
with disposable B projects/uploads and an independently managed authenticated server.
Record actual Codex version, host identity and results. Verify streaming disconnect,
approval wait disconnect, immediate post-submission disconnect, quiet-turn liveness,
remote-only paths/attachments and checksums, Windows roots where available, optional
API denial, native turn pagination and profile switching with a reused forwarding
URL. Resolve ambiguous outcomes from authoritative B state before resending.
MCP provider OAuth needs actual callback reachability testing from the browser host.
Do not delete existing uploads or interrupt a production connection for these tests.

## Reviewable commits

| Commit | Subject |
| --- | --- |
| 06f7883 | fix: preserve remote Windows roots and group nested skills |
| 46b60d3 | Recover thread subscriptions with bounded concurrent retries and surface uncertainty |
| 07b673b | feat: isolate remote workspace state by explicit connection profile |
| f70313f | feat: account for retained uploads with shared capacity controls |
| e7634c7 | Verify recovery guidance in browser fixtures and isolate lifecycle test transport |
| 5314c8a | feat: diagnose remote workflow compatibility and expose upload accounting |
| 69242bf | Retain uncertainty when a submission response is lost |
| 6ad8d79 | Verify restored subscriptions deliver events and preserve drafts |
| 3e65832 | perf: bound remote file caches and page upstream thread history |
| 755b98e | perf: coalesce concurrent native history pages and bound seeks |
| 8b28289 | fix: isolate browser drafts and caches across connection profiles |
| 40bf6a7 | test: require rejection of history from a retired connection |
