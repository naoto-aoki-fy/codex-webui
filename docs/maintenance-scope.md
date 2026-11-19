# Maintenance scope

This is the current maintenance overview. [Development](development.md) owns setup,
profiling and tools; [native Project migration](native-project-migration.md) owns
supported runtime versions, capabilities and upgrade procedures;
[open items](maintenance/open-items.md) owns unresolved concerns.
The pinned 0.167.2 type generator is independent of the runtime support baseline.

Earlier maintenance-cleanup, native-maintenance-cleanup, native-maintenance-acceptance,
scoped-persistence-cleanup and native-codex-cleanup documents are historical evidence,
not competing upgrade instructions. Their numbering belongs to earlier scopes.
Immutable wiki raw material remains untouched.

## Current cleanup boundaries

| ID | Outcome and implementation |
| --- | --- |
| 03 | Removed App cwd/basename inference and Sidebar path-context naming. Native Project IDs, names, roots and order are authoritative; empty options remain empty, desktop/backend errors remain explicit. |
| 04 | Simplified installed Skills to name, description, path and enabled. Readme requires name and optionally path; fixed owner/installed arguments are removed. Details, toggles and Composer selection remain. |
| 05 | Removed unused path/translation imports, account context and workspace-group argument; shared helpers remain. |
| 06 | Removed translation-wrapper tests with their subject. English language is checked by the browser fixture. Dynamic component, recovery, provider and migration fixtures remain active. |
| 07 | Frontend workspace state retains ordered roots, native Projects/mode and errors. Legacy labels, active, projectOrder and remoteProjects remain backend migration inputs. No persisted state is stripped or rewritten. Cache cloning/invalidation remain necessary. |
| 08 | Retired account login routes retain JSON 409 guidance; unused context is removed. CLI login remains a failing guidance command. Authentication belongs to the external server; Web password auth is unchanged. |
| 09 | Retired rebuild uses the common JSON 404 handler before SPA fallback; local scanning remains unsupported. |
| 10 | Unsupported token refresh directly returns correlated protocol error -32001. Removed throwing async helper/re-export; no credentials or refresh network request are accessed. |
| 11 | Removed useUiLanguage/t; English labels, conditional expressions and installed-count interpolation are direct. index.html declares English. |
| 13 | Extracted thread-list identity comparison, pruning and reconciliation into threadListReconciliation. Shared desktop lifecycle, send, approval and event ownership remain together. No generic store or new subscriptions. |
| 14 | Extracted file-change labels, deltas and summaries into fileChangePresentation. Parsing, media, scrolling and imported rendering retain their existing strategy. |
| 15 | Removed obsolete App branches and extracted native option/root presentation into useNativeProjectOptions. Existing folder/settings/transfer dialogs retain ownership. |
| 16 | Simplified Sidebar native-name presentation, removing path collision scans. Existing threadVisibility and row components retain search, pagination, pins and actions. |
| 17 | Extracted profile-scoped draft serialization, validation and fork-recovery reads into composerDraftStorage. Keyboard/IME, upload, submission and settings state remain in Composer. Keys/payloads are unchanged. |
| 18 | Current ownership is consolidated in this overview, development, migration policy and open-items. Previous acceptance records are explicitly historical. |
| 19 | README has one upgrade link and no duplicate mobile description or trailing compatibility link. |
| 20 | Thread profiling requires PROFILE_THREAD_ID or PROFILE_ROUTE; TestChat profiling requires TESTCHAT_ROOT. Missing inputs fail before browser launch. |
| 21 | Standalone scripts are retained documented diagnostics/live harnesses. Added credential-free intercepted UI acceptance. No script is deleted solely for lacking a package entry. |
| 22 | Generator derives actual handwritten consumer dependency closure, removes stale generated TS and retains the full method catalog. Pin and runtime policy are unchanged. |
| 23 | DirectoryHub renamed SkillsMcpHub, including import and navigation test; styling classes are preserved. |
| 24 | Intentionally retain minimal sw.js. Older registrations require the same URL to clear only codexweb-shell/assets caches and unregister. Both server entry points have fixture coverage. Removal requires an explicit support policy excluding old registrations. |
| 25 | Intentionally retain read-only Project receipts and independent pin guards. Native records do not prove legacy migration completion. Removal requires real completion/support evidence; no cutoff or receipts are fabricated. |
| 26 | Already simplified before this scope: no list snapshots, names, timestamps or archive writes. PersistentThreadIndex retains durable intent, uncertain-response reconciliation, duplicate prevention, profile isolation, locking and atomic writes. Unknown historical fields and disk paths are preserved. |
| 27 | Account rate-limit reads pass through the native response and ordinary RPC errors. A server that cannot decode a quota response cannot supply a fresh snapshot. |
| 28 | Dependencies remain used by runtime, tests, scripts or generation. No unrelated upgrade/lockfile churn. proper-lockfile protects send recovery; Codex supplies pinned generation, Playwright supplies acceptance and zstd supplies rollout tests. |

## Permanent product boundaries

[Protected product requirements](product-requirements.md) define CAP-001 Fork and
Revert, CAP-002 Portable Fork and CAP-003 Historical Response Metadata (timestamp,
model, reasoning effort). These permanent behavioral guarantees supersede reliance
on historical cleanup items **01, 02 and 12**. Internal implementations may evolve;
ordinary cleanup or upstream migration does not authorize functional reduction.
Retain and update the linked regression coverage when changing related code.
Injected-only Portable import discoverability remains the documented upstream
limitation; no client-owned index or fabricated ordinary turn is introduced.

## Performance evidence and limits

Folder options map the native list instead of scanning cwd groups and duplicate
basenames. Sidebar names use direct label lookup instead of scanning all groups.
Draft serialization and reconciliation are extracted unchanged. No requests,
subscriptions, listeners, caches, retries or fanout are added. Frontend cloning
no longer allocates unused legacy maps/arrays. Unsupported auth refresh no longer
schedules a rejected promise. Generated types affect build-time maintenance only.
No live latency/heap improvement is claimed. Bundle output and fixture request
counts are verification evidence, not production performance measurements.

Build evidence for this scope: main UI chunk 380.38 → 376.73 kB, conversation
chunk 68.94 → 69.09 kB, CLI 182.28 → 180.98 KB (uncompressed build output).
This is a bundle comparison, not evidence of faster rendering or lower heap use.
