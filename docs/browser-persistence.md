# Browser persistence audit and ownership

Keys below omit `codex-web-local.`. Profile-scoped keys use the original key for
`legacy`, and `codex-profile.<encoded profile>.<original key>` for named profiles.
The active profile is fixed for the document; switching profiles reloads it.
No unknown keys are reset. This inventory covers production browser code, not test
fixtures or server-side files. Source paths are relative to `src/`.

## Inventory before changes

| Key / schema | Read / write owner | Scope | Authority, necessity and risks |
| --- | --- | --- | --- |
| `connection-profile.v1`: string | `utils/browserConnectionProfile.ts` | global default; URL override | Needed default on new visits. Existing documents retain their profile. URL is authoritative when present. |
| `selected-thread-id.v1`: string | `composables/desktopStatePersistence.ts`, `useDesktopState.ts` | profile | Redundant with route; home already clears selection. Cross-tab last-writer navigation hazard. Remove runtime access. |
| `model-usage-order.v1`: string array | unused loader in `desktopStatePersistence.ts` | global legacy | No runtime reader; backend model-preferences store owns accepted usage. No usage migration depends on this key. Remove loader. |
| `thread-token-usage.v1`: thread → token breakdown | `desktopStatePersistence.ts`, `useDesktopState.ts` | profile/thread | Notification-derived cache. No freshness metadata, unbounded whole-map writes. Server emits `thread/tokenUsage/updated`; ordinary history read does not guarantee a fresh snapshot. Stop restoring stale browser values; show unavailable until observed. |
| `selected-model-by-context.v1`: context → model selection | `desktopStatePersistence.ts`, `useDesktopState.ts` | profile/thread + legacy new-thread context | Explicit unsent choices cannot be reconstructed from server execution metadata. Legacy defaults migrate to backend. Whole-map stale writes can lose other threads. |
| `selected-model-id.v1`: string | fallback loader, removed after successful selection save | profile legacy | Needed migration fallback. Preserve until migration writes succeed. |
| `reasoning-by-provider-model.v1`: encoded provider/model → effort | `desktopStatePersistence.ts`, backend migration in `useDesktopState.ts` | profile legacy | Read-only migration input. Backend owns current preferences; retain legacy input. |
| `collaboration-mode-by-context.v1`: context → `plan` | `desktopStatePersistence.ts`, `useDesktopState.ts` | profile/thread | Thread-local unsent selection; absence means default. Whole-map writes have lost-update risk. New-thread mode is backend-owned. |
| `collaboration-mode.v1`: `plan`/`default` | legacy fallback in `desktopStatePersistence.ts` | profile legacy | Backend migration input; preserve until successful save. |
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

There is no production IndexedDB, sessionStorage, cookie, OPFS or other explicit
browser persistence before this change. Ordinary HTTP/browser caches are managed
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

Performance: each save serializes one current draft, not all threads; this retains
synchronous localStorage image costs from v1. Recovery enumeration happens only
on explicit request. No server requests, timers, fanout, or cache invalidation
are introduced. Archived snapshots can consume quota; this is deliberately
preferred to silently deleting recoverable drafts. IndexedDB/blob migration and
an explicit archive-management UI remain possible future improvements.
