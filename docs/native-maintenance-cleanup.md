# Focused native maintenance cleanup

> Historical verification record. Numbering and commands describe that review.
> Current ownership: [maintenance scope](maintenance-scope.md). Current support and upgrades: [native server contract](native-project-migration.md).

| Item | Change |
| --- | --- |
| 3 | Removed historical-image prompt heuristics and send-time image lookup. Explicit images and historical rendering remain. |
| 4 | Removed `scoreFileCandidate`, substring exclusion and local sort. Native fuzzy order, paths, validation and result limit remain. |
| 6 | Removed Project import/migration implementation, read-only runtime fallback and `legacyDesktopProjectGroups`. Native membership uses IDs; a read-only upgrade guard retains legacy parsing and completion-receipt checks. |
| 7 | Removed legacy pin moves/state deletion and full-history pager fallback. Native sections, absolute indices, cursors and race guards remain. |
| 8 | Native provider/model service tiers govern Fast availability; unknown/unsupported states are explicit. Per-turn tier parameters prevent inherited unsupported tiers. Fixed credit/speed claims are gone. |
| 9 | Removed local CLI missing detector/state/banners. External errors, reconnect and uncertain submission handling remain. |
| 10 | Removed `directoryCwd`, `attachmentFeedbackText` and its formatting helper. Pending upload eligibility and upload/session result bookkeeping remain. |
| 11 | Removed `openProjectRoot`, `ChatMessage`, `ChatThread`, and `rollbackSelectedThread`. Revert tests use `executeThreadRevert`; active selection and fork/revert flows remain. |
| 12 | Removed unused credential-store readers/guards, canonicalization functions and compatibility exports. Public auth redaction and shared persistence/locks remain. Remote paths pass through unchanged. |
| 13 | Replaced legacy inference/migration tests with upgrade-boundary/native tests; corrected retired persistent-index/rebuild documentation. Retirement safeguards remain. |

See [supported server capabilities](native-project-migration.md).
The old release must complete Project and pin migration before upgrade. No user
files, credentials, browser storage, native sections or transfer receipts are
cleaned up. No dependent removal remains blocked: legacy parsing is intentionally
retained solely for the non-mutating upgrade guard, and full native thread reads
remain required by Portable Fork and revert outside the paginated path.

## Performance audit

Code-path comparison: image submission no longer scans previous messages or
repeats old image payloads. Search adapts and slices the native result without a
second scoring/filtering/sort pass. Projects read only native project pages plus
the existing small profile state guard; there are no thread-list/import/update
fanouts or migration writes. Pin reads only native section-filtered pages; no
legacy move RPCs or state writes occur. Native history retains identical bounded
index/page caches, coalescing, invalidation and cursor validation; unsupported
servers fail instead of transferring full item histories. Fast capability lookup
uses the existing reactive catalog, with no extra requests, and an explicit
per-turn tier parameter. Removed canonicalizers no longer clone/list-map every
thread or expose host realpath callbacks. No new blocking I/O, unbounded fanout,
cache or dependency was added.

Production build: main frontend JS 381.78 kB (123.57 kB gzip); CLI 188.52 kB.
Fixture integration asserts one upstream connection per running WebUI. History
unit tests verify coalesced identical pages and item bytes below one tenth of full
history hydration. No live latency/profile measurements were performed.

## Validation

Baseline: `pnpm run test:unit`: 94 files passed, 1,283 tests passed, two skipped.
Final commands/results are recorded in the completion report. All fixtures use
disposable state; they do not prove real authentication/model execution.

Browser fallback: Browser Use was unavailable; Playwright used the actual composer
at `http://127.0.0.1:4173/#/thread/cleanup-fixture`, viewport 1280x900, with synthetic
HTTP/WebSocket responses. Supported native Fast switch enabled and light/dark
surfaces rendered correctly. Screenshots:
`output/playwright/cleanup-fast-light.png` and
`output/playwright/cleanup-fast-dark.png`. The full SFC renderer additionally
verifies unavailable/unknown states and provider switching; gateway tests assert
Fast/default request parameters and rejection without RPC for unknown support.
Live Codex turns, migration, auth and reconnect were not exercised in a real home.

Executed validation commands for this historical change (some fixtures were later retired).
For current history verification, see [native thread history](native-thread-history.md).

```sh
pnpm exec vitest run src/composables/useDesktopState.test.ts src/composables/useDesktopState.messages.test.ts src/server/composerFileSearch.test.ts src/server/codexCredentials.test.ts src/server/workspaceRootsStore.test.ts
pnpm exec vitest run src/server/nativeProjects.test.ts src/server/remoteHistoryPager.test.ts src/server/threadPresentationStore.test.ts src/utils/nativeProjectGroups.test.ts src/utils/desktopProjectGroups.test.ts
pnpm exec vitest run src/components/content/ThreadComposer.submission.test.ts src/api/modelCapabilities.test.ts src/api/codexGateway.test.ts
pnpm exec vitest run src/api/normalizers/v2.test.ts
pnpm run typecheck
pnpm run test:unit
pnpm run build
pnpm run test:integration:fixture
CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture
node -e "const {execFileSync}=require('node:child_process');const h=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!h.includes('--port'))throw Error('Missing --port');console.log('CLI help smoke passed')"
PLAYWRIGHT_BROWSERS_PATH=/tmp/cleanup-playwright node output/playwright/cleanup-fast.cjs
```

All passed. Final full suite: 94 files passed, 1,262 tests passed, two skipped.
Both frontend/server type checks, frontend/ESM CLI builds, TCP/Unix transport
fixtures and the public CLI help process passed. The public package is ESM, so
the CJS smoke harness uses `execFileSync` against its public CLI entry rather
than attempting `require` of an ESM executable. No pre-existing test failures
were found. Playwright initially lacked its browser binary; it was installed
under `/tmp` and the check rerun successfully.

The subsequent [focused acceptance audit](native-maintenance-acceptance.md)
identified and fixed independent legacy-pin fencing and the remaining adapter
pagination fallback. It records the six upgrade cases, exact Fast frames,
deleted-test mapping, verification layers and reproducible migration source.
