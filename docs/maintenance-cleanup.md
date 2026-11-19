# Maintenance cleanup status

> Historical verification record. Numbering and commands describe that review.
> Current ownership: [maintenance scope](maintenance-scope.md). Current support and upgrades: [migration policy](native-project-migration.md).

## Final scope status

| Item | Status | Result |
| --- | --- | --- |
| 1 | Completed | Obsolete repository-status implementation/UI hooks removed; retired URL returns JSON 404. Other Git/diff capabilities remain. |
| 2 | Completed | Unused local command, resolution and invocation modules/tests removed. Remote filesystem/search operations remain. |
| 3 | Completed | Unreachable custom list merger, synthetic cursors, list reconciliation/recovery and legacy callback removed. Durable attachment submission intents, acceptance checks and pending state remain. |
| 4 | Completed | Standalone 0.168.0 compatibility adapter, patch, dedicated manifests/probes/fixtures/tests and deployment guide removed. Native providers and fork operations remain. |
| 7 | Completed | Persistent fresh-fork registry, provider-triggered re-fork, first-turn tracker, special recovery writes, replacement routing and prefix auto-archive removed. Ordinary drafts and ambiguous-send protection remain. |
| 8 | Completed | Runtime historical-metadata recording/store/hooks removed. Old stores remain untouched. Persistent rollout-derived caching remains. |
| 10 | Completed, with native metadata limitation | Source-to-fork copying/matching removed. Live Native Fork preserved three turns, native revert retained one, and source content stayed unchanged. Destination rollouts on 0.169.0 supplied no inherited turn contexts, so inherited model/effort display is unknown. |
| 11 | Completed | Repeatable non-destructive native Project migration, native mutations and verified association/order handling implemented. Empty projects, names, roots, order, archived members and existing imported-content receipts are preserved. Conditional capability/identity failures stop migration explicitly. |
| 12 | Completed | Native sidebar grouping, ordering, folder selection, new-thread creation and optimistic fork rows use native project IDs. Cwd remains an execution path. Old path inference is restricted to one-time migration or explicit read-only compatibility display. |
| 13 | Completed | Unsupported external refresh delivers error -32001; no unused success branch, credential callback or single-flight promise remains. |
| 14 | Completed review; fallback retained | Native structured rate-limit responses are preferred. Narrow unknown-plan decode recovery remains; see removal condition below. |
| 15 | Completed | Frontend DTOs and backend slices share pinned 0.167.2 generated definitions. Duplicate unversioned snapshots are removed; generation and runtime compatibility were audited. |
| 16 | Completed | Obsolete dev2 shim/alias and unpacked debug launcher removed. Normal development/build/test commands work. |
| 17 | Completed for this scope | Unit, integration-fixture, 11 mocked browser cases and disposable live/browser acceptance passed. Manual procedures and architecture docs are updated. Broader deployment limits remain explicitly unverified below. |

## Native Project migration and retries

See [implementation and compatibility details](native-project-migration.md).
Native Projects are the writable source of identity, names, roots, positions and
membership. The legacy root registry has no production writer, including CLI
registration. Its original fields, unknown data, inactive browser project preferences and
Portable transfer receipts remain intact. The workspace HTTP response is a projection of native data, not a
second persistent registry. Native change notifications invalidate browser caches.

The profile/endpoint/remote-home-scoped journal captures legacy input once and
records acknowledged destination IDs before validation. Stable native import
idempotency keys and migration tags recover lost replies; checkpoints recover
incompatible replies without creating another destination. Each name/root record,
member association and final project order is verified. Partial failures retain
the snapshot and retry unfinished work. Existing native associations changed by
another client are not overwritten; explicit conflicts require reconciliation.
Injected-only imports missing from native lists are discovered from their existing
receipts and their native summaries are checked once during migration.

Only explicit -32601 for project/list before migration enables `legacy-readonly`.
Project writes remain disabled there. Permission, transport, malformed responses,
unsupported import/association/order operations, and capability loss after
migration starts never reactivate legacy writes. Normal conversation content can
still load independently of a project-state error. The pinned schema is not a
capability guarantee for other external deployments.

## Rollout-cache evidence and exact path

Architecture remains:

`Codex rollout JSONL -> reader/parser -> persistent rollout-derived cache -> history normalization/UI`

`AppServerClient` triggers optional recovery on content-bearing history reads.
`RolloutGenerationMetadata.recover` resolves the rollout with metadata-only
`thread/read`, stats it with `fs/getMetadata`, then reads
`<remote CODEX_HOME>/cache/model-history/v1/<sha256(threadId)>.json` using
`fs/readFile`. A valid source path/version/positive mtime/execution-provenance cache
is reused. Otherwise, complete native `turn_context` rows are parsed by exact turn
ID; a second stat guards publication, and `fs/createDirectory`/`fs/writeFile`
persist only the compact cache. Metadata notifications merge into per-thread
history state and the V2 normalizer/ThreadConversation display. Source rollouts
are never written through filesystem APIs. Legacy metadata stores are untouched
and neither read nor relabeled as rollout evidence.

Specific evidence:

- Cold live read extracted two actual model/effort contexts and created the cache.
- A new reader reused it. A separately launched Node process, using a bundle of
  the actual reader, recovered both turns with **zero original-rollout reads**.
- Completing a third native turn refreshed the cache to three entries with one
  source transfer. Unchanged data was not unnecessarily reparsed.
- Native Fork and Fork and Revert retained content with zero inherited metadata
  entries; no source values leaked into the destination. Unit cases also cover
  colliding turn IDs across unrelated threads, appended/replaced rollouts,
  conflicting rows, malformed/partial data and unsupported/denied filesystem APIs.
- Missing metadata does not block history or fabricate composer settings. The live
  browser displayed rollout-derived `gpt-6-luna / low` while the composer selected
  Medium. Labels survived refresh in light and dark themes.

The metadata API exposes mtime but no source file size. Rewrites preserving the
same timestamp require explicit refresh; this pre-existing validation limitation
is unchanged. Reader limits remain 16 MiB/source, 2 MiB/cache, 10,000 turn IDs,
one serialized source transfer and at most 16 queued/coalesced threads.

## Checks actually run

| Layer | Command/evidence | Result |
| --- | --- | --- |
| Baseline from existing commits | test:unit | 90 files / 1,268 tests passed; one skipped |
| Unit | `pnpm run test:unit` | 93 files / 1,281 tests passed; two opt-in live tests skipped |
| Focused after final migration optimization | `pnpm exec vitest run src/server/nativeProjects.test.ts src/api/revertHistoryRead.test.ts` | 13 passed |
| Type checking | `pnpm run typecheck` | Passed for Vue/frontend and server |
| Build | `pnpm run build` | Passed; frontend/precompression and public ESM CLI |
| Integration fixture | `pnpm run test:integration:fixture` | Built CLI and dev server passed HTTP RPC, metadata, browser WebSocket, retired JSON 404s, one initialization and independent fixture survival |
| Mocked browser | `PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright node scripts/test-fork-methods.cjs` | All 11 cases passed at 1280x900, including Native/Portable entry points, failure cases and old imported content |
| Live and browser | Gated command in the [live checklist](../tests/website-docs-misc/maintenance-live-acceptance.md) | Passed against independently managed `codex-web-local/0.169.0`, Rocky Linux 9.8, default OpenAI/gpt-6-luna |
| Protocol generation | `pnpm run generate:project-file-protocol` plus SHA-256 comparison | Identical 176 type files and method catalog: 177 artifacts |
| CJS smoke | Command below | Passed |
| Diff | `git diff --check` | Passed |

```sh
node -e "const {execFileSync}=require('node:child_process');const out=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!out.includes('Usage:'))throw new Error('Missing CLI help');"
```

There are no public CJS exports. The CJS harness launches the public ESM CLI.
The fresh-process rollout check separately requires the actual reader's temporary
CJS test bundle. Neither requires a dependency upgrade.

Live acceptance verified native create and import idempotency, name/root updates,
ordering, explicit associations, deletion, repeat migration, legacy-field/receipt
preservation, and migration of an imported conversation created before migration.
It verified actual native fork/revert, Portable injection and content after service
recreation/reload, model history via the rollout cache, and Fork and Revert prompt
restoration after refresh. Only disposable threads/projects were mutated; five test
threads were archived and two migration projects deleted, in addition to the
create/delete probe. Existing native project order was asserted unchanged.

Browser Use was unavailable; Playwright request interception restricted list
visibility to test-created IDs while backend operations remained live. Actual
changed UI was checked at `http://127.0.0.1:4173`, 1440x1000:

- [Light sidebar/history screenshot](../output/playwright/maintenance-native-projects-light.png)
- [Dark sidebar/history screenshot](../output/playwright/maintenance-native-projects-dark.png)
- [Restored prompt screenshot](../output/playwright/maintenance-fork-revert-draft.png)
- [Live assertions and cleanup evidence](../output/playwright/maintenance-live.json)

Screenshots were inspected; dark surfaces were correctly themed. Port 4173 is
left running from this checkout with a disposable local application home. The
persistent 5173 server was not stopped or restarted.

## Protocol and performance audit

Compared the DTO facade before consolidation (`46186aa`) with current consumers:
all 18 exported DTO names remain. The manual modelProvider extension is now part
of generated ModelListParams. Normalizers accept thread-only resume/fork responses
without requiring readState, and tolerate the native image union. ReasoningEffort
uses the native string type. No active consumer imports removed snapshots.
Live 0.169.0 exercised native pagination, fork/revert, inject-items, filesystem/cache,
Project operations and thread metadata updates; model/provider discovery ran
through the actual browser. Approval/authentication handlers remain independently
covered by unit/integration fixtures. package.json and the lockfile have no
continuation dependency changes; 0.167.2 remains the generator baseline.

Completed project reads need only native project pagination plus one asynchronous
local migration-receipt read. Startup callers coalesce their project read, and
thread listing waits for initial migration so it cannot publish old path-derived
associations. Migration reads summary pages, not conversation payloads; import
receipt discovery and association verification are bounded and serial, without
unbounded fanout. Membership maps avoid repeated per-project group scans and
quadratic thread-ID searches. No synchronous filesystem work is added. The only
new fork/revert recovery is one read-only retry for an index invalidation race;
mutations are never replayed. Native change events invalidate project caches.

Cold/warm rollout fixtures still assert seven/three RPCs respectively, with one
source transfer across cold plus restart. The live fresh-process check confirms
that behavior on the real filesystem service. Current CLI output is about 209 kB
uncompressed. No baseline bundle comparison, large-migration latency, browser heap
profile or duplicate-request improvement is claimed; browser flows deliberately
navigate and refresh repeatedly.

## Compatibility limits and retained fallback

- Current native fork/revert rollouts omit inherited context rows: model/effort
  for those turns remains unknown, while content remains accessible.
- Native 0.169.0 thread/list omits injected-only Portable conversations, even after
  naming them and with all-provider, database-only and title-search queries.
  The before/current comparison below classifies this as pre-existing. After the
  first completed ordinary turn, native listing and fresh-start UI discovery work;
  injected-only destinations remain undiscoverable through those UI lists/searches.
  Imported content and native project association are preserved. No fabricated turns or
  custom merged index were introduced to hide this upstream discovery limitation.
- Live checks covered one POSIX host and its default provider. Separate-host
  tunnels, Windows runtime, other server releases, cross-provider inference and
  live approval/redelivery scenarios were not exercised here. Those retain their
  unit/fixture/manual coverage and explicit capability checks.
- Keep distinct connection profiles for independent remote hosts. Endpoint/home
  strings cannot identify a replaced server instance with the same values.

## Continuation commits

- `eff44c6` — Migrate legacy projects to native Project APIs and IDs
- `1d03cc8` — Keep fork-and-revert routing and prompt restoration consistent
- `7bf704d` — Add live maintenance and fresh-process rollout-cache acceptance
- `06715f7` — Preserve inactive legacy project preferences during startup
- The documentation handoff commit containing this report is titled
  `Finalize maintenance cleanup compatibility and acceptance report`.

The final documentation commit also corrects the new legacy-preference regression
test to use stopPolling for lifecycle cleanup; its initial dispose call failed,
and the corrected targeted test, full suite, typecheck, build and fixture all
passed before handoff. No baseline test failures were observed.

All work stayed on main. No commits were pushed.

## Portable discoverability acceptance comparison

**Conclusion: pre-existing native discovery limitation, not a cleanup regression.**
The earlier URL-based display check did not establish discoverability; this
comparison explicitly tests fresh-start discovery without using destination URLs.
No production discovery code or additional application-owned state was introduced.

Compared the actual pre-cleanup build at `de7fde9` (parent of the first cleanup
commit `9dc2470`) with current production source at `de138cc`. The baseline was
exported with git archive and built in /tmp using the same dependency tree; no
branch was created or switched. Both applications used the same independently
managed `codex-web-local/0.169.0` server, OpenAI provider, gpt-6-luna model, source
conversation, working directory and explicit naming. One Portable destination
was created through each version's real conversation-transfer API. The source
had one ordinary completed turn and served as a positive listing control.

The precise sidebar listing conditions were archived=false, limit=50,
sortKey=updated_at, modelProviders=[], cursor=null, with every returned cursor
exhausted. Additional native probes used projectId, cwd, useStateDbOnly=true and
title searchTerm filters; native thread/search used known imported content.
The old creation path initially left projectId null, while current creation set
it. The baseline destination was explicitly assigned to the same test Project
before the equivalent-membership comparison. Assignment and naming did not make
an injected-only destination discoverable.

| Observation after application process restart and a fresh browser context | Pre-cleanup | Current |
| --- | --- | --- |
| Injected-only: native ordinary turns | 0 | 0 |
| Injected-only with correct native Project ID: global/project/cwd/database/title-filtered native listing | Absent | Absent |
| Injected-only: actual application thread/list response | Absent | Absent |
| Injected-only: sidebar, title search, imported-content search from home | Not discoverable | Not discoverable |
| First completed ordinary turn: native listing, project listing and application response | Present | Present |
| Fresh-start sidebar/title/content search after that turn | Discoverable | Discoverable |
| Reopen by clicking the sidebar, without a saved URL | Imported text preserved | Imported text preserved |

The omission occurs in **native listing/search before application grouping**.
Native thread/read confirmed the same correct Project ID even while both global
and project-filtered listings omitted the destination. The applications returned
the same stable native list results. Pre-cleanup AppServerClient.rpc already
bypassed PersistentThreadIndex for thread/list, and the bridge supplied an empty
legacy callback; the removed merger was not providing durable import discovery.
Both versions inserted only a temporary optimistic Portable row, with a 120-second
confirmation grace period. That is not persistent discovery after a reload.

The first ordinary turn was sent through each actual application, using the same
provider/model and destination ID, with a small text prompt and no attachments or
tools. Both turn/start replies initially reported inProgress. Native visibility
changed asynchronously: the first global native probe still omitted the thread,
then later project/cwd/database and application queries included it during the
same probe sequence. By completed-turn verification, all ordinary listings and
native content search included it. After another application restart and an empty
browser context, sidebar and UI search found it and a sidebar click reopened the
original imported prompt/answer plus the new ordinary turn. No duplicate threads
were created. This establishes the tested eventual condition, not an atomic
listing guarantee at turn/start acknowledgement. Failed/rejected first turns,
other providers and other native server releases were not tested.

Executed `node --check scripts/test-portable-discoverability.cjs`, the archived
baseline's `pnpm run build`, and the opt-in live command in the
[reproduction checklist](../tests/website-docs-misc/portable-discoverability-comparison.md).
The final comparison passed all four fresh-process UI cases (two versions, before
and after the ordinary turn), at 1440x1000 in light/dark themes, with no browser
page errors. Browser Use was unavailable in this session; Playwright also enabled
the response interception needed to hide unrelated user data. Real responses were
filtered only to hide unrelated user records;
no test rows were injected and no discovery filters were changed. The home routes
were http://127.0.0.1:4194/#/ for baseline and http://127.0.0.1:4173/#/ for current.
Evidence: `output/playwright/portable-discoverability.json`. The comparison harness is
standalone test tooling; no production TypeScript, dependencies, registries or
metadata/cache modules changed in this acceptance follow-up. `pnpm run typecheck`
was also rerun.

The final baseline post-turn UI open encountered the history-index invalidation
race (`History changed while loading`) and recovered after one explicit read-only
refresh. The final current open needed no such refresh. Both occurrences and the
absence of any remaining visible history error are recorded separately from
listing/discovery assertions. The test never retries a mutation to recover a UI
read error.

Screenshot paths (all under
`/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/`):

- `portable-discovery-before-injected-only-light.png` and `-dark.png`
- `portable-discovery-current-injected-only-light.png` and `-dark.png`
- `portable-discovery-before-ordinary-completed-light.png` and `-dark.png`
- `portable-discovery-current-ordinary-completed-light.png` and `-dark.png`

The test archived only its three disposable threads and deleted its one native
Project. Both comparison application processes were stopped; the independently
managed Codex server and user conversations/projects were not modified. Original
rollouts, temporary comparison homes and transfer receipts were retained. The
current 4173 development server was restarted afterward from this checkout.

No runtime change is justified as a cleanup regression fix. The tested native
membership/naming/listing APIs provide no observed way to register these normal
injected-only threads into ordinary discovery without an ordinary turn. The
pinned root-thread listing schema offers no general include-empty flag. A native
server change making persisted injected history eligible for ordinary listing and
search would address the underlying limitation without client-owned indexing.

The smallest client alternative would be a bounded read-only **Recent imports**
chooser derived from the existing persistent conversation-transfer receipts. It
could show receipt previews and validate the native destination on selection,
without a new persistent store or merging native pagination. Its maintenance cost
is one paginated receipt endpoint, a UI entry and profile/stale/archived/error
handling plus restart/browser tests; native reads can be limited to selected
entries rather than startup fanout. That would be a separate feature, not a
restored index merger or fresh-fork state machine. It has not been implemented.
Runtime metadata recording, metadata inheritance and rollout-cache ownership are
unchanged by this verification.

This follow-up adds the reproducible live comparison and documentation in the
commit `Verify Portable discoverability before and after cleanup`. It contains
no production behavior change and remains unpushed.
