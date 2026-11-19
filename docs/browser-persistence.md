# Browser persistence audit and ownership

Keys below omit `codex-web-local.`. Profile-scoped keys use the original key for
`legacy`, and `codex-profile.<encoded profile>.<original key>` for named profiles.
The active profile is fixed for the document; switching profiles reloads it.
No unknown keys are reset. This inventory covers production browser code, not test
fixtures or server-side files. Source paths are relative to `src/`.

## Historical inventory before the persistence changes

For retired prompt records, see [UI settings after changes](#ui-settings-after-changes).

| Key / schema | Read / write owner | Scope | Authority, necessity and risks |
| --- | --- | --- | --- |
| `portal_session`: 32 random bytes as 64 hex characters | `server/authMiddleware.ts`: `buildSessionCookie` writes on password login/link; middleware and request/WebSocket authorization read Cookie header | host-wide auth, Path=/; shared across tabs and connection profiles | Necessary WebUI authentication capability; not reconstructible from routes or App Server. HttpOnly, SameSite=Lax, 30-day Max-Age/Expires; server validates expiry against persisted sessions. Concurrent logins replace the shared cookie but both tokens remain valid. Retained unchanged; no browser migration or frontend access. |
| `connection-profile.v1`: string | `utils/browserConnectionProfile.ts` | global default; URL override | Needed default on new visits. Existing documents retain their profile. URL is authoritative when present. |
| `selected-thread-id.v1`: string | `composables/desktopStatePersistence.ts`, `useDesktopState.ts` | profile | Redundant with route; home already clears selection. Cross-tab last-writer navigation hazard. Remove runtime access. |
| `model-usage-order.v1`: string array | unused loader in `desktopStatePersistence.ts` | global legacy | No runtime reader; backend model-preferences store owns accepted usage. No usage migration depends on this key. Remove loader. |
| `thread-token-usage.v1`: thread → token breakdown | `desktopStatePersistence.ts`, `useDesktopState.ts` | profile/thread | Notification-derived cache. No freshness metadata, unbounded whole-map writes. Server emits `thread/tokenUsage/updated`; ordinary history read does not guarantee a fresh snapshot. Stop restoring stale browser values; show unavailable until observed. |
| `selected-model-by-context.v1`: context → model selection | `desktopStatePersistence.ts`, `useDesktopState.ts` | profile/thread + legacy new-thread context | Explicit unsent choices cannot be reconstructed from server execution metadata. Global defaults are backend-owned. Whole-map stale writes can lose other threads. |
| `selected-model-id.v1`: string | fallback loader, removed after successful selection save | profile legacy | Needed migration fallback. Preserve until migration writes succeed. |
| `reasoning-by-provider-model.v1`: encoded provider/model → effort | None | profile legacy | Retired. Backend owns current reasoning preferences. |
| `collaboration-mode-by-context.v1`: context → `plan` | `desktopStatePersistence.ts`, `useDesktopState.ts` | profile/thread | Thread-local unsent selection; absence means default. Whole-map writes have lost-update risk. New-thread mode is backend-owned. |
| `collaboration-mode.v1`: `plan`/`default` | None | profile legacy | Retired. Backend owns current global mode. |
| `explicit-model-contexts.v1`: context array | `useDesktopState.ts` | **incorrectly global** | Distinguishes explicit unsent choices from observed execution defaults; model map includes both, so membership cannot safely be inferred. Scope and preserve legacy migration; whole-array writes lose membership. |
| `thread-draft.v1.<thread>`: payload or legacy string | `utils/composerDraftStorage.ts`, composer, App fork restoration | profile/thread | Text, images, files, Skills, Apps have no server authority before submission. Durable recovery necessary. Same-thread tabs overwrite/delete each other. |
| `thread-fork-recovery.v1.<thread>`: draft payload/string | fallback reader in `composerDraftStorage.ts`; no current writer | profile/thread | Protected Fork and Revert recovery input; retain. |
| `queue-submissions.v1`: thread → client message ID, max 20 / 90 KB | `utils/queueSubmissionReceipts.ts`, `composables/nativeQueue.ts` | profile/thread | Safety marker saved **before** RPC; missing queue row never proves non-execution. Whole-map RMW loses markers, same-thread overwrites can erase identity. Never replay. Malformation/storage failure must block submission. |
| `prompt-library.v1`: `{presets,history}` (20/30 entries, 8,000 chars) | `utils/promptLibrary.ts`, `components/content/PromptLibrary.vue`, `composerInput.ts` | profile | Presets are user data. Automatic accepted-text history is optional. Whole-record saves lose concurrent changes; clearing history must preserve presets. Credential-like filtering required. |
| `send-with-enter.v1`: `1`/`0` | `App.vue` | global | Necessary UI preference; scalar last-writer wins acceptable. Storage access currently can throw. |
| `dark-mode.v1`: system/light/dark | `App.vue` | global | Necessary UI preference; scalar last-writer wins. System theme itself is reconstructible. |
| `chat-width.v1`: standard/wide/extra-wide | `App.vue` | global | UI preference; scalar last-writer wins. |
| `sidebar-collapsed.v1`: `1`/`0` | `App.vue` | global | UI preference; scalar last-writer wins. |
| `sidebar-width.v1`: number string (clamped) | `components/layout/DesktopLayout.vue` | global | UI preference; scalar last-writer wins. |
| `chat-sort-mode.v1`: created/updated | `components/sidebar/sidebarThreads.ts`, `SidebarThreadTree.vue` | global | UI preference; scalar last-writer wins. |
| `thread-view-mode.v1`: project/chronological | same sidebar owners | global | UI preference; scalar last-writer wins. |
| `collapsed-projects.v1`: project → boolean | `SidebarThreadTree.vue` | global/project | UI preference; whole-map last-writer may lose unrelated expansion changes. |
| `sidebar-section-expansion.v1`: `{pinned,projects}` booleans | `SidebarThreadTree.vue` | global | UI preference; whole-record last-writer may lose unrelated expansion changes. |
| `native-authentication-pending.v1`: obsolete latch | delete-only `utils/legacyNativeAuthenticationStorage.ts` | legacy + named profiles | Already retired, never used as authority. Existing narrowly scoped cleanup retained. |

There is no production IndexedDB, sessionStorage, document.cookie API, or OPFS
usage before this change. A server-issued authentication cookie is inventoried
below; it is browser persistence even though frontend JavaScript cannot read it. Ordinary HTTP/browser caches are managed
by the browser. `public/sw.js` is a retirement worker: deletes only
`codexweb-shell-*` / `codexweb-assets-*` CacheStorage entries and unregisters; it
has no fetch handler and no new worker is registered. Old project/read-state,
terminal, queue, language and provider keys mentioned in historical tests/docs
have no active production reader; leave them untouched rather than guessing at
migration needs. Server project configuration, native queue, imported portable
history, response metadata and model preferences remain server-owned.

## Safety constraints

CAP-001 draft restoration survives navigation/reload and never submits itself.
CAP-002 source drafts and imported history remain intact. CAP-003 response metadata
is unaffected. Legacy profile data must never be imported into a named profile.
Older open application versions cannot cooperate with a new persistence protocol;
retained legacy inputs must not be destructively consumed.

## Draft ownership after changes

Drafts use profile-scoped `thread-draft.v2.<encoded thread>.<tab ID>.<writer ID>`
keys with the original payload schema. `sessionStorage` holds `tab-id.v1` and a
profile/thread `thread-draft.v2.<encoded thread>.resume` pointer. A new random writer
ID is allocated for every document, even when Duplicate Tab copies the session ID
and resume pointer. Each document writes only its own key. Reload follows the
session pointer; duplicate tabs copy the same starting snapshot then diverge.
Empty payloads are tombstones: clear cannot resurrect v1 or fork recovery data.
Legacy inputs and predecessor snapshots are never consumed or automatically pruned.
A fresh tab can explicitly copy them using **Recover saved drafts**. The picker
never deletes another writer's data. Without sessionStorage, fresh document keys
still isolate writes, but recovery requires that picker. With failed localStorage
writes, drafts remain in memory and the composer warns that closing can lose them.
A failed draft read is also visible and stays flagged until a read succeeds;
a successful subsequent write alone does not prove the earlier data was recovered.

Performance: each save serializes one current draft, not all threads; this retains
synchronous localStorage image costs from v1. Full recovery payload enumeration happens only
on explicit request. A thread with no owned/resume record also scans key names
once to decide whether legacy auto-import is appropriate. No server requests, timers, fanout, or cache invalidation
are introduced. Only failed saves retain an extra in-memory payload copy. Archived snapshots can consume quota; this is deliberately
preferred to silently deleting recoverable drafts. IndexedDB/blob migration and
an explicit archive-management UI remain possible future improvements.

## Queue receipt atomicity

Queue receipts now live in IndexedDB database `codex-web-local.persistence.v1`,
version 1, object store `records`. The primary key is the profile-scoped original
`queue-submissions.v1` key; its value keeps the bounded prompt-free object schema.
A transaction reads the current object, validates it, applies one reservation or
compare-clear, and writes the result. Completion is awaited **before** the RPC.
Writes request strict durability. Unsupported/blocked/failed IndexedDB disables
queue submission; there is no unlocked fallback and no automatic replay.

The old localStorage receipt map is read only when no IndexedDB record exists.
The first successful mutation imports the complete valid map within the same
transaction. Empty IndexedDB records override legacy data, so acknowledgment
cannot resurrect an old marker. The original localStorage input is retained as a
conservative backup. Malformed or oversized input blocks migration/submission.
The controller marks itself busy before reservation and refuses changed selection,
connection epoch or concurrent jobs during asynchronous recovery reads. Accepted
or rejected replies clear only their exact client identity. Uncertain outcomes
still require explicit inspection and acknowledgment; missing native queue rows
are never evidence of non-execution.

Web Locks and IndexedDB-as-a-lock around localStorage were evaluated and rejected:
a repeated real-tab run lost 4 of 16 receipts because different renderers could
read stale localStorage snapshots even after callback serialization. The final
implementation stores the actual record in IndexedDB and uses one transactional
primitive in every context, regardless of Web Locks availability.

Performance: one bounded (20 entries/90 KB) record transaction per reservation or
settlement, no transaction held over network traffic, no polling/replay. Queue
recovery adds one asynchronous IndexedDB read at controller startup, no server
request. Old open application versions cannot cooperate with this protocol;
reload them before queue use. Downgrading to an older release cannot see new
IndexedDB receipts and is not a safe recovery procedure.

## Safe upgrade: mixed versions are unsupported

**Old-version and new-version tabs must not submit concurrently.** This release
has no cross-version handshake. Older code rewrites localStorage and cannot see
new IndexedDB receipts. Once an IndexedDB record exists, newer code does not keep
merging later legacy writes. New-version tabs alone are covered by concurrency
tests; an old tab bypasses those protections.

Use this procedure for every browser context/origin and connection profile:

1. Pause submissions in **all** app tabs before opening the new build. Let known
   in-flight requests settle. Record any lost/delayed acknowledgment as unresolved;
   do not retry it, even if the native queue row is absent.
2. Preserve each tab's visible draft before reloading: text, images/original image
   sources, file paths, Skills and Apps. Older same-thread tabs may already have
   overwritten their shared v1 draft, so copy directly from each live composer.
   Back up only the relevant legacy/named-profile draft and queue-receipt records;
   if a new tab has already run, preserve its IndexedDB `records` entries too.
3. Keep unresolved thread/client message IDs from both stores. Inspect native
   queue/history against these identities. Preserve the browser profile and saved
   records; do **not** clear browser/site storage or delete receipts to unlock Send.
4. Deploy the new build and reload **every** existing app tab, including duplicate,
   pinned, background and installed-app windows, before any further submission.
   Check that all tabs load the same deployment's assets. Do not keep an old tab
   active for rollback or run an older release against the migrated browser data.
5. Verify each tab's URL/profile and draft against its backup. Restore missing
   content through **Recover saved drafts** or the preserved per-tab copy; do not
   submit it as a migration check. v1 inputs and archived writer snapshots remain
   available; migration does not automatically delete drafts.
6. Verify unresolved receipt identities in the new profile-scoped IndexedDB
   `queue-submissions.v1` record and recovery UI before resuming. First mutation
   imports a valid legacy map when no IndexedDB record exists. If versions already
   overlapped, do not assume a later old-tab marker was imported: preserve the
   union of both stores' identities and inspect queue/history before proceeding.
   This release provides no automatic mixed-version reconciliation or replay.
   A missing row is not proof of non-execution. Explicit uncertainty acknowledgment
   remains a deliberate decision after inspection, not an upgrade shortcut.

Browser-storage clearing is not a recovery procedure. Read/storage failure means
keep the tab and backups intact and restore access; no automatic reset is performed.
See [focused final acceptance evidence](browser-persistence-acceptance.md) for the
transaction traces and the distinction between fixture and live-server evidence.

## Navigation, model choices and token usage after changes

Removed runtime keys/loaders: `selected-thread-id.v1`, `model-usage-order.v1`,
`thread-token-usage.v1`. Old stored values are inert and left intact; no broad
cleanup runs. Each tab starts with empty selection and App initializes it from
its own route. Home stays home. Token usage is memory-only, cleared on connection
loss, new turn and revert. **Verified limitation:** the current history protocol
adapter does not hydrate token usage after reload. Usage stays unavailable until a
server usage event, rather than presenting an old snapshot as authoritative. No
extra startup RPC or polling is added. Backend accepted-model usage remains the
only ordering source; legacy browser usage is never migrated as accepted usage.

Retained legacy model/collaboration/reasoning inputs are read for compatibility.
New writes use one string entry per encoded context:
`selected-model-by-context.v2.<context>`,
`collaboration-mode-by-context.v2.<context>` (`plan`; empty means default), and
`explicit-model-contexts.v2.<context>` (`1`; empty clears). All are profile-scoped.
Writers compare their own previous snapshot and write only changed contexts;
there is no shared read-modify-write map. Different contexts cannot overwrite
each other. Same-context concurrent choices intentionally use last-writer wins.
Empty-string tombstones override legacy inputs without deleting them. Storage
events refresh shared preferences, never routes or drafts. Explicit membership
is retained because observed server model metadata also populates the model map;
that map alone cannot distinguish unsent user choices. The old global explicit
array is read **only** in the legacy profile. Named profiles start independently.
A partial/sidebar thread list no longer deletes persistent choices.

Performance: context writes are constant-size instead of rewriting all threads.
Startup/event hydration enumerates storage keys once per preference map; no new
network requests, timers or unbounded async fanout. Legacy input remains read-only
and may be retained indefinitely. Context tombstone compaction is deferred to
avoid resurrecting old selections.

## UI settings after changes

Existing prompt presets and submitted-prompt history remain in legacy browser
storage. The WebUI no longer reads, updates, migrates or clears the retired
prompt-library records, consent keys or invalidation keys.

Harmless UI preference reads/writes now tolerate storage denial. Scalar UI keys
retain their schema and intentionally use last-writer wins; theme, width, send
behavior, sidebar visibility/sort/view update through storage events. Composite
sidebar preferences use independent string (`1`/`0`) records at
`collapsed-projects.v2.<encoded project>` and
`sidebar-section-expansion.v2.<pinned|projects>`, retaining v1 as read-only fallback.
There is no shared map rewrite, and unrelated project toggles survive concurrency.

Performance: no new dependencies or startup RPCs. Prompt transactions run only on
explicit edits or opted-in accepted text. UI scalar events are constant work;
composite preference hydration scans localStorage keys, with no network fanout.

Fresh documents automatically import legacy v1/fork recovery only when no v2
record exists for the thread. Once v2 exists, legacy snapshots remain available
through explicit recovery rather than resurrecting submitted content. Recovery
first archives the current nonempty draft under a new writer key; if that backup
fails, replacement is refused. Thread IDs are encoded including dots to avoid
prefix collisions in recovery enumeration.


## Final storage boundaries and deferred work

- URL/browser history: per-tab navigation via `src/router/index.ts` and
  `appRouteCoordinator.ts`, plus explicit connection-profile hint. Browser back/forward
  restores route entries; no additional localStorage navigation copy.
- HttpOnly `portal_session` cookie: server-issued shared WebUI authentication,
  retained unchanged and independent of connection-profile data.
- sessionStorage: tab identity and per-profile/thread resume pointers.
- localStorage: UI preferences/context choices, tab/document-owned drafts and
  retained migration inputs.
- IndexedDB: atomic queue recovery receipts. No draft
  migration to IndexedDB is needed for ownership safety; unique writer keys avoid
  shared draft mutations. Draft blob/quota handling remains a separate improvement.
- App Server: conversation/imported history, response metadata, authoritative
  native queue, global model preferences and accepted model usage.

Intentionally deferred: automatic archive cleanup (would risk recoverable drafts),
IndexedDB image/blob drafts, legacy/context tombstone compaction, live server
latency profiling, and old-version simultaneous writers. Browser eviction, manual
site-data clearing and unavailable/quota-limited storage cannot guarantee durable
unsent recovery. No automatic replay compensates for missing browser data.

## Current key disposition and runtime owners

All names below still omit `codex-web-local.` and use the profile encoding defined
above, unless explicitly marked global.

| Disposition | Key / schema | Current read and write locations | Ownership / recovery |
| --- | --- | --- | --- |
| Retired runtime | `selected-thread-id.v1`, `model-usage-order.v1`, `thread-token-usage.v1` | None; inert legacy values untouched | URL, backend accepted usage, and observed in-memory usage respectively |
| Legacy thread contexts | `selected-model-by-context.v1`, `selected-model-id.v1`, `collaboration-mode-by-context.v1` | Read-only fallback in `composables/desktopStatePersistence.ts` | Profile-scoped |
| Retired global preferences | `collaboration-mode.v1`, `reasoning-by-provider-model.v1` | None | Backend owns global defaults and reasoning |
| Retained marker migration | Global `explicit-model-contexts.v1`: string array | Read-only in `useDesktopState.ts`, only for legacy profile | Never inherited by named profiles |
| New context records | `selected-model-by-context.v2.<encoded context>`: JSON string; `collaboration-mode-by-context.v2.<encoded context>`: JSON `plan` or empty tombstone; `explicit-model-contexts.v2.<encoded context>`: JSON `1` or empty tombstone | `utils/browserPreferenceRecords.ts`, called by `useDesktopState.ts`; storage-event hydration there | Profile/thread; distinct contexts independent, same context last-writer wins; choices cannot all be reconstructed from executed server metadata |
| Migrated drafts | `thread-draft.v1.<thread>`, `thread-fork-recovery.v1.<thread>` | Read-only in `utils/composerDraftStorage.ts` | Profile/thread; legacy recovery preserved |
| New owned drafts | `thread-draft.v2.<encoded thread>.<tab>.<writer>`: full draft payload; archive writer starts `archive-` | `composerDraftStorage.ts`; called by `ThreadComposer.vue`, `composerInput.ts`, existing App restoration path | Profile/thread/tab/document; empty payload tombstones; never auto-pruned |
| New session metadata | Global `tab-id.v1`: random string; profile/thread `thread-draft.v2.<encoded thread>.resume`: owned localStorage key | `utils/browserTabIdentity.ts`, `composerDraftStorage.ts` | sessionStorage; reload lineage only, not shared navigation; collision-safe writer IDs |
| Migrated critical records | localStorage `queue-submissions.v1`: old schema | Read-only fallback in `queueSubmissionReceipts.ts` | Profile; retained migration backup, not runtime write authority |
| New atomic records | IndexedDB `codex-web-local.persistence.v1` / `records`, primary key = scoped `queue-submissions.v1`; value = bounded receipt map | `utils/browserTransactionalRecords.ts`, `utils/queueSubmissionReceipts.ts`, `composables/nativeQueue.ts` | Profile; transactionally authoritative queue recovery data |
| New sidebar records | Global `collapsed-projects.v2.<encoded project>`, `sidebar-section-expansion.v2.<pinned|projects>`: JSON `1`/`0` strings | `browserPreferenceRecords.ts`, `SidebarThreadTree.vue` | Shared UI preference per entry; v1 composite keys retained read-only |
| Retained scalar UI preferences | Global `send-with-enter.v1`, `dark-mode.v1`, `chat-width.v1`, `sidebar-collapsed.v1`, `sidebar-width.v1`, `chat-sort-mode.v1`, `thread-view-mode.v1`: schemas in original inventory | `utils/browserUiStorage.ts`, App/layout/sidebar callers in original inventory | Shared settings, best-effort storage, last-writer wins with storage-event visibility |
| Retained connection and retirement behavior | `connection-profile.v1`, obsolete auth latch cleanup, retired service-worker caches | Original owners unchanged | No unknown data reset; active profile fixed for document |

## Historical verification and performance evidence

These results describe the persistence change before the prompt library was retired.

Verified with the current checkout and Chromium on `http://127.0.0.1:4173`:

- Full unit suite: **1,589 passed, 2 skipped** (150 test files passed, 2 skipped).
- `pnpm run typecheck`: passed (frontend and server TypeScript).
- `pnpm run build`: passed; 318 frontend modules, main JS 495.69 KB / 158.33 KB gzip,
  lazy prompt-library JS 5.11 KB / 2.10 KB gzip; frontend build 5.53 seconds in this
  run. CLI remains 209.15 KB ESM. No dependency changes.
- `pnpm run test:integration:fixture`: passed for built CLI and dev transport;
  one upstream connection per fixture, independent fixture survives shutdown.
- CJS host smoke on Node 22.23.2:
  `node -e "process.argv = ['node', 'codexapp', 'help']; const entry = require('./dist-cli/index.js'); console.log('CLI entry exports:', Object.keys(entry))"`
  exited 0, printed CLI help and `CLI entry exports: []` (CLI exports no library API).
- `node scripts/test-browser-persistence.cjs`: passed actual concurrent document
  operations with Web Locks both available and disabled. Includes different routes,
  same-thread writes, clearing one writer, duplicate session identity, reload,
  structured draft payloads, archiving before recovery, same-thread receipt
  exclusion, compare-clear, legacy receipt/preset/history migration, history opt-in,
  preset UI concurrency, model storage-event rendering, named-profile isolation,
  unavailable IndexedDB, and zero native submission RPCs during the test.
- Three further browser stress runs passed both configurations. All 16 receipts
  survived every final transactional run; measured bursts took **32–54 ms** across
  two pages. These are fixture/browser measurements, not live server latency.
- `node scripts/test-connection-profiles.cjs`: passed legacy → named → legacy
  draft restoration and same-profile document retention, light and dark.
- `node scripts/test-approved-prompts.cjs`: passed create/edit/reload/use,
  explicit opt-in recording, command handling, clear-all; 1280, 375 and 768 widths.
- `node scripts/test-risk-queue.cjs`: passed accepted/delayed/lost acknowledgment,
  double-click exclusion, draft retention, reload recovery and no replay;
  1280, 375 and 768 widths in light/dark themes.

No live App Server authentication/turns or high-volume archive profiling was
performed. Full profiler helpers were not used because these checks intercept the
server protocol; live startup/server timing cannot be inferred from a fixture.
Code-path audit checked duplicate requests (no new RPC), blocking work (draft JSON
and UI key scans remain synchronous; critical records are asynchronous), fanout
(no per-thread startup RPCs or timers), payload bounds, and invalidation (only
committed prompt revisions; per-tab routes/drafts never subscribe). Persistent
context/archive key growth and localStorage image serialization remain limitations.

Screenshots exercise the actual prompt dialog after reload and cross-tab edits.
Test URL: `http://127.0.0.1:4173/?connection-profile=legacy#/thread/a`.
Viewports: 1440x1000, 375x812, 768x1024; both light/dark. Result: presets survived,
history opt-in/clear worked, and dark surfaces rendered correctly. Files are in
`output/playwright/browser-persistence-<width>-<theme>.png` under this checkout
(`/home/naoto-aoki/Projects/20261105-codexapp-dev/output/playwright/`). Generated
screenshots are deliberately not committed. Representative evidence:

![Light prompt dialog](../output/playwright/browser-persistence-375-light.png)
![Dark prompt dialog](../output/playwright/browser-persistence-375-dark.png)

Additional screenshots: `connection-profiles-{light,dark}.png`,
`approved-25-{1280,375,768}-{light,dark}.png`, and
`risk-07-{1280,375,768}-{light,dark}.png` in the same directory.


## Modified files

- [docs/browser-persistence.md](../docs/browser-persistence.md)
- [scripts/test-browser-persistence.cjs](../scripts/test-browser-persistence.cjs)
- [scripts/test-connection-profiles.cjs](../scripts/test-connection-profiles.cjs)
- [scripts/test-risk-queue.cjs](../scripts/test-risk-queue.cjs)
- [src/App.vue](../src/App.vue)
- [src/components/content/ThreadComposer.submission.test.ts](../src/components/content/ThreadComposer.submission.test.ts)
- [src/components/content/ThreadComposer.vue](../src/components/content/ThreadComposer.vue)
- [src/components/content/composerInput.ts](../src/components/content/composerInput.ts)
- [src/components/layout/DesktopLayout.vue](../src/components/layout/DesktopLayout.vue)
- [src/components/sidebar/SidebarThreadTree.vue](../src/components/sidebar/SidebarThreadTree.vue)
- [src/components/sidebar/sidebarThreads.ts](../src/components/sidebar/sidebarThreads.ts)
- [src/composables/desktopStatePersistence.test.ts](../src/composables/desktopStatePersistence.test.ts)
- [src/composables/desktopStatePersistence.ts](../src/composables/desktopStatePersistence.ts)
- [src/composables/nativeQueue.test.ts](../src/composables/nativeQueue.test.ts)
- [src/composables/nativeQueue.ts](../src/composables/nativeQueue.ts)
- [src/composables/useDesktopState.messages.test.ts](../src/composables/useDesktopState.messages.test.ts)
- [src/composables/useDesktopState.modelPreferences.test.ts](../src/composables/useDesktopState.modelPreferences.test.ts)
- [src/composables/useDesktopState.test.ts](../src/composables/useDesktopState.test.ts)
- [src/composables/useDesktopState.ts](../src/composables/useDesktopState.ts)
- [src/utils/browserPersistence.multitab.test.ts](../src/utils/browserPersistence.multitab.test.ts)
- [src/utils/browserPreferenceRecords.test.ts](../src/utils/browserPreferenceRecords.test.ts)
- [src/utils/browserPreferenceRecords.ts](../src/utils/browserPreferenceRecords.ts)
- [src/utils/browserTabIdentity.ts](../src/utils/browserTabIdentity.ts)
- [src/utils/browserTransactionalRecords.ts](../src/utils/browserTransactionalRecords.ts)
- [src/utils/browserUiStorage.test.ts](../src/utils/browserUiStorage.test.ts)
- [src/utils/browserUiStorage.ts](../src/utils/browserUiStorage.ts)
- [src/utils/composerDraftStorage.test.ts](../src/utils/composerDraftStorage.test.ts)
- [src/utils/composerDraftStorage.ts](../src/utils/composerDraftStorage.ts)
- [src/utils/queueSubmissionReceipts.test.ts](../src/utils/queueSubmissionReceipts.test.ts)
- [src/utils/queueSubmissionReceipts.ts](../src/utils/queueSubmissionReceipts.ts)
- [tests/chat-composer-rendering/composer-expands-long-drafts-to-full-screen.md](../tests/chat-composer-rendering/composer-expands-long-drafts-to-full-screen.md)
- [tests/chat-composer-rendering/native-prompt-queue.md](../tests/chat-composer-rendering/native-prompt-queue.md)
- [tests/chat-composer-rendering/persistent-model-reasoning-preferences.md](../tests/chat-composer-rendering/persistent-model-reasoning-preferences.md)
- [tests/theme-layout-terminal/dark-theme-settings-controls.md](../tests/theme-layout-terminal/dark-theme-settings-controls.md)

## Implementation commits

- `434db06 docs: inventory browser persistence ownership and concurrency risks`
- `d0b123e fix: isolate composer drafts by tab and document writer`
- `b63525f fix: serialize queue recovery receipt mutations before submission`
- `a87e48a fix: shard thread preferences and retire redundant browser caches`
- `6291866 fix: make prompt history opt-in and merge preset edits atomically`
- `8c00305 fix: synchronize UI preferences without shared map overwrites`
- `60fe9f3 fix: persist only affected model contexts and keep home unselected`
- `66ced27 fix: unify atomic persistence on IndexedDB transactions`
- `5b6a50a fix: archive live drafts before recovery and avoid legacy resurrection`
- `d85c80c fix: store recovery receipts and prompt libraries in atomic IndexedDB records`
- `81e900c test: verify real-tab persistence migration and queue recovery`

The final documentation commit records this complete inventory and verification
report. All work was committed on `main`; no push or branch switch was performed.
