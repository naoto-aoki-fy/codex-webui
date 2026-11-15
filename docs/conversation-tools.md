# Conversation tools and read-only account information

## Runtime evidence and scope

The implementation reuses the browser gateway, the independently managed App
Server connection, native thread identity/project membership and the normal
normalized history pager. No local Codex lifecycle, authentication, provider
proxy, rollout scanner, archive index or usage-history store is added.

The repository's [runtime floor and native contract](native-project-migration.md)
and [connection ownership](external-app-server.md) still apply. The bundled
0.167.2 protocol and method catalog are advisory, not capability negotiation.
These features were validated with credential-free fixtures, **not a live Codex
runtime or production account**. A connected server can reject these operations.

Upstream contracts inspected at OpenAI Codex commit
`b016cd18472588606c04af565528c4cd6746a41f`:

- [Thread schemas](https://github.com/openai/codex/blob/b016cd18472588606c04af565528c4cd6746a41f/codex-rs/app-server-protocol/src/protocol/v2/thread.rs):
  native archived `thread/list` filtering, opaque cursors, `thread/unarchive` with
  `{threadId}` returning the original `Thread`, and thread settings/resume scope.
- [Account schemas](https://github.com/openai/codex/blob/b016cd18472588606c04af565528c4cd6746a41f/codex-rs/app-server-protocol/src/protocol/v2/account.rs):
  `account/usage/read` returns nullable token-activity summaries and daily buckets.
  Null params request account-wide activity; this UI does not request thread usage.
- [Turn schemas](https://github.com/openai/codex/blob/b016cd18472588606c04af565528c4cd6746a41f/codex-rs/app-server-protocol/src/protocol/v2/turn.rs)
  and [configuration enum](https://github.com/openai/codex/blob/b016cd18472588606c04af565528c4cd6746a41f/codex-rs/protocol/src/config_types.rs):
  web-search configuration is distinct from turn overrides.

## Feature assessment and delivered behavior

| ID | Existing reusable behavior | Smallest supported implementation | Limits / regression risk |
| --- | --- | --- | --- |
| 09 | Native archive action, normalized thread list, project reconciliation | Expand **Archived conversations** in the sidebar; refresh/load more; restore via native unarchive and reconcile acknowledged thread identity into active project lists | Requires native archived filtering/unarchive. Failed or ambiguous restores retain the row and show an error; refresh before retrying. Persistence is server-owned. Native pins/read receipts are not mutated. |
| 11 | Normal detail/older-page APIs, imported-transcript decoration, historical metadata normalizer | Selected thread menu → **Export conversation as Markdown** downloads complete available completed content, oldest first | Excludes the turn active in the initial read, including its input; notes exclusion in file/status. No partial file on failure. Raw internal/unhandled payloads and hidden instructions are omitted. Images/attachments remain references, not embedded remote file bytes. Missing metadata remains missing. |
| 22 | Composer model/effort/fast/collaboration controls; generic thread resume configuration | **Blocked for this low-risk scope; no new control or preference** | Enum contains `disabled`, `cached`, `indexed`, `live`. `turn/start` and `thread/settings/update` have no dedicated web-search override; start/resume accept generic configuration, but their returned settings do not confirm effective web-search mode. This iteration does not alter resume/subscription/send ownership to experiment with unverifiable configuration or write global config. Default sending is unchanged. A validated scoped mechanism with effective-setting evidence is needed. |
| 24 | Existing account settings, quota/context displays, RPC transport | Settings → Account → **Account usage history** → **Refresh account usage** | Only real lifetime/peak token counts, longest-turn seconds, streak days and returned daily buckets. Account-wide activity is separate from context tokens and remaining rate limits. No costs, inferred records or local aggregation. Nullable/missing values are unavailable; empty buckets mean no records returned. |
| 32 | Existing compatibility endpoint, capability observations, shared desktop notification owner | Settings → Account → **Warnings and diagnostics**; read diagnostics, inspect/copy report | Latest 20 browser-observed warnings, cleared on connection changes. Runtime version stays unavailable; platform comes from initialization. Copied report excludes all free-form text and paths/URLs/profile names. No feedback upload. Existing compatibility probes remain a separate explicit action. |

The protected [CAP-001/002/003 guarantees](product-requirements.md) remain in
place. Export includes the existing Portable Fork prefix exactly once, before
native history, and uses reliable historical metadata with provenance. It never
uses current composer settings as historical evidence. Fork, in-place revert,
immediate steering, interruption and approval paths are unchanged.

Read jobs are invalidated on connection readiness/replacement, disconnect,
reconnect and desktop teardown. Late export results cannot download a file and
late archive/usage/diagnostic results cannot populate the next connection scope.
Profiles remain backend-owned; switching one still requires the documented restart.
A remote export is not an atomic server-wide snapshot against concurrent edits by
other clients. Page/boundary errors fail closed; ordinary streaming of the excluded
active turn cannot enter the exported snapshot.

The export serially requests older pages only on click. It has a 1,000-page and
33,554,432 JavaScript-code-unit content budget; exceeding either fails rather than
truncates. This is a text safety ceiling, not a precise peak heap/UTF-8 byte limit.
Browser downloads use a sanitized basename and `text/markdown` Blob URL.

## Tests and verification

Automated coverage:

- `src/composables/archivedThreads.test.ts`: no eager requests, pagination/dedup,
  empty/error states, acknowledged/rejected restore and stale-result rejection.
- `src/composables/useDesktopState.test.ts`: native project reconciliation,
  rejected restore and bounded warning capture using the existing subscription.
  Existing CAP/fork/read-receipt/steering/reconnect tests remain active.
- `src/composables/conversationExport.test.ts`: unloaded pages, repeated imported
  prefixes, ordering, Markdown/code, attachments, historical/missing metadata,
  duplicate jobs, page failures, cursor loops, active exclusion and connection changes.
- `src/composables/accountUsage.test.ts`: nullable metrics, empty/missing history,
  actual units, malformed responses, unsupported versus permission errors,
  in-flight coalescing and stale-connection results; no automatic request loop.
- `src/diagnostics.test.ts`: buffer/text bounds, redaction, allowlisted reports,
  unrecognized diagnostics and missing capability evidence.
- `scripts/test-external-app-server.cjs`: unchanged generic RPC errors and scoped
  unsupported usage errors through both built CLI and dev-server entry points.
- `scripts/test-conversation-tools.cjs`: intercepted protocol/event fixtures,
  restore/pagination/rejection/reload, real Markdown download inspection, generation
  exclusion/fetch failure, usage units/empty/unsupported, warning bounds, clipboard
  sanitization, no external requests, and actual changed light/dark UI at
  1280×900, 375×812 and 768×1024. No paid calls or credentials.

Exact commands (run from repository root):

```sh
pnpm run typecheck
pnpm exec vitest run src/composables/archivedThreads.test.ts src/composables/useDesktopState.test.ts
pnpm exec vitest run src/composables/conversationExport.test.ts src/api/normalizers/v2.test.ts src/server/conversationTransfer.test.ts
pnpm exec vitest run src/composables/accountUsage.test.ts src/server/codexAppServerBridge.archive.test.ts src/api/codexRpcClient.test.ts
pnpm exec vitest run src/diagnostics.test.ts src/composables/useDesktopState.test.ts src/server/remoteCapabilities.test.ts
pnpm run test:unit
pnpm run build
pnpm run test:integration:fixture
node dist-cli/index.js --help
PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-conversation-tools.cjs
```

The public CLI is ESM, with no public
CJS library export; its built CLI help and CJS-driven integration fixture verify
entry-point loading without adding a new package entry.

Manual acceptance:
[archives](../tests/thread-loading-state/thread-archive-recovery-and-sidebar-pruning.md),
[export](../tests/git-worktrees-rollback/thread-menu-copy-chat-action.md),
[usage](../tests/accounts-feedback-observability/account-usage-history.md),
[diagnostics](../tests/accounts-feedback-observability/sanitized-diagnostics.md).

## Performance audit

- **09:** zero archive requests at startup. One native 50-row list request per
  explicit page, serial in-flight guard, ID deduplication. Restore uses one native
  mutation and the existing coalesced forced active-list refresh. It merges the
  acknowledged thread even when that older thread is outside the first active page.
  Native project membership drives grouping; no cwd inference or archive store.
- **11:** zero export-history requests before click. One normal initial detail
  read followed by serial 10-turn pages; no parallel fanout or new history system.
  Existing backend index/page coalescing and metadata bounds apply. Text processing
  and the final Blob are linear in returned content; batches/Maps/serialization
  create temporary allocations bounded by the safety ceiling. Very large exports
  can block the browser while formatting; live large-history heap/time was not measured.
- **24:** zero usage calls before refresh; one in-flight request per mounted view;
  no timer/polling. Five summary fields and initially 30 daily rows render; further
  rows require clicks. Server response payload size is not client-controlled.
- **32:** compact read uses existing in-memory initialization/capability evidence,
  with no upstream probes or project-list read. The separate compatibility button
  retains its existing explicit coalesced probes and upload inventory request.
  Warnings retain at most 20×600 text characters plus timestamps; redaction scans at most 6,000 characters per event. No added event
  subscription, background RPC, timer, external feedback request or raw-log buffer.
- Build output: main JS approximately 419.59 kB / 134.11 kB gzip; no dependency,
  framework, protocol baseline or storage migration changes. Live request latency,
  account availability, and server-side pagination/restore persistence still require
  validation with the deployment's independently managed Codex server.

Browser evidence is saved under `output/playwright/` (ignored generated artifacts),
including `conversation-tools-results.json` with request counts/payload totals and
`tools-<width>-<archive|export|usage|diagnostics>-<light|dark>.png`.

Validation results: type checks passed; focused suites passed; full unit suite
passed (1,353 tests passed, 2 skipped; 105 files passed, 2 skipped). Production frontend/CLI build passed. The final
credential-free integration fixture passed built and dev entry points, correlated
RPC errors, scoped unsupported usage evidence and one upstream connection per
entry point; the independently managed fixture listener survived WebUI shutdown.
The browser script passed all three viewports and both themes, with no page errors
or external requests. Each viewport's exercised run recorded 46 API responses,
9.65 KiB combined fixture JSON, three archive list pages (including reload), three
manual usage reads and two diagnostic reads. This is fixture traffic, not live
server latency or a startup benchmark. No archive/usage/older-export page was fetched
at startup. The final basename, command-detail and warning-processing safeguards passed
focused regressions, full checks and the repeated browser matrix.

## Changed files

- `PROJECT_SPEC.md`
- `docs/conversation-tools.md`
- `scripts/test-conversation-tools.cjs`
- `scripts/test-external-app-server.cjs`
- `src/App.vue`
- `src/api/accountUsage.ts`
- `src/api/codexErrors.ts`
- `src/api/codexGateway.ts`
- `src/api/codexRpcClient.test.ts`
- `src/api/codexRpcClient.ts`
- `src/components/sidebar/AccountSettingsPanel.vue`
- `src/components/sidebar/AccountUsage.vue`
- `src/components/sidebar/ArchivedThreads.vue`
- `src/components/sidebar/ConnectionDiagnostics.vue`
- `src/components/sidebar/SidebarThreadTree.vue`
- `src/components/sidebar/sidebarContracts.ts`
- `src/composables/accountUsage.test.ts`
- `src/composables/accountUsage.ts`
- `src/composables/archivedThreads.test.ts`
- `src/composables/archivedThreads.ts`
- `src/composables/conversationExport.test.ts`
- `src/composables/conversationExport.ts`
- `src/composables/desktopConnection.ts`
- `src/composables/useDesktopState.test.ts`
- `src/composables/useDesktopState.ts`
- `src/diagnostics.test.ts`
- `src/diagnostics.ts`
- `src/server/codexAppServerBridge.ts`
- `src/style.css`
- `tests/accounts-feedback-observability/account-usage-history.md`
- `tests/accounts-feedback-observability/index.md`
- `tests/accounts-feedback-observability/sanitized-diagnostics.md`
- `tests/git-worktrees-rollback/thread-menu-copy-chat-action.md`
- `tests/thread-loading-state/thread-archive-recovery-and-sidebar-pruning.md`

All verification commands above passed on the final source. The ESM CLI help
returned exit code 0 and printed the expected command/options. The browser URL was
`http://127.0.0.1:4173/#/thread/tools-fixture`; screenshots cover 1280×900,
375×812 and 768×1024, both light and dark. Example evidence:

![Light usage at 375×812](../output/playwright/tools-375-usage-light.png)
![Dark sanitized report at 375×812](../output/playwright/tools-375-diagnostics-dark.png)

The verification dev server on 4173 was left running; the persistent server on
5173 was not stopped or restarted. No branches were created/switched and no commit
was pushed, merged or rebased.
