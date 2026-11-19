### Feature: Maintenance acceptance against a disposable live dataset

Prerequisites: an independently managed POSIX Codex App Server with matching
credentials and filesystem, Project, pagination, inject-items and revert APIs.
Record its initialization version. The test creates small real model turns using
its default provider; never use an existing user conversation as the source.
The harness isolates WebUI state and caches and writes build fixtures under a disposable artifacts directory.

Setup and actions:
1. Inspect any listener on 4173 and its cwd. Start this checkout there with a new
   temporary OS WebUI storage directory and a dedicated App Server ID. Keep the
   independently managed Codex server and the persistent 5173 server running.
   Set `MAINTENANCE_STATE_HOME` below to a separate temporary artifacts directory. Install Chromium in a writable temporary browser
   cache if necessary (`PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright pnpm exec
   playwright install chromium`).
2. Run:

   ```sh
   PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright \
   CODEX_MAINTENANCE_LIVE=1 \
   MAINTENANCE_STATE_HOME=/tmp/<disposable-artifacts-directory> \
   MAINTENANCE_BROWSER_BASE_URL=http://127.0.0.1:4173 \
   pnpm exec vitest run src/server/maintenance.live.test.ts
   ```

3. Inspect `output/playwright/maintenance-live.json`, the light/dark screenshots,
   and `maintenance-fork-revert-draft.png`. Expect native create idempotency, name/root
   updates, ordering, association, empty projects and deletion. Portable Fork
   persists imported content across a transfer-service restart.
4. Expect cold persistent rollout-cache creation, reuse in a fresh Node process
   with zero source reads, and one source refresh after a third native turn.
   Native fork/revert content remains accessible; missing inherited metadata is
   unknown. No cache values are copied from the parent.
5. Browser checks use real backend operations and native responses, filtering
   only list visibility to test-owned IDs. Expect native sidebar ordering/labels,
   empty-project selection after refresh, source model history after refresh,
   imported content after reload, and the exact restored prompt after Fork and
   Revert and another refresh. The viewport is 1440x1000 in light/dark themes.
6. Separately run `PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright node
   scripts/test-fork-methods.cjs` for the 11 mocked browser cases. These are
   fixture checks, not live provider evidence.

Expected failures: unavailable live credentials/model execution, missing APIs,
unsupported browser dependencies or a stale/error-page dev server are failures,
not skipped passes. Unit/CI runs skip the opt-in live test automatically.

Cleanup: the harness archives only its own threads, deletes only its own native
projects and verifies pre-existing native project order is unchanged. Native
rollouts and their parsed caches remain; test workspace directories and the local
application home remain available for inspection. Preserve old metadata stores.
Keep 4173 running unless asked to stop it. Remove disposable artifacts deliberately
when their inspection is complete. A second host, Windows server, live approvals
and cross-provider inference are outside this same-host acceptance run.

### Feature: Native Project and pin adapter verification

Install repository dependencies and run the disposable filesystem and RPC fixtures:

```sh
pnpm exec vitest run src/server/nativeProjects.test.ts src/server/nativeThreadPins.test.ts src/server/projectHistory.test.ts src/server/connectionProfile.test.ts
```

The fixtures exercise native Project creation, rename, move, deletion,
paginated pins, profile isolation and read errors. A fixture with old local
roots, pins and an incomplete receipt must show the native list and pins, then
match the original bytes. Tests remove their temporary directories.

## Credential-free maintenance UI regression

Prerequisites: installed dependencies and Playwright Chromium; current checkout's
verification server on 127.0.0.1:4173 (inspect listener/cwd first).
Run `node scripts/test-maintenance-ui.cjs`. If browsers are installed outside the
usual cache, supply PLAYWRIGHT_BROWSERS_PATH.

The harness intercepts all APIs and WebSocket notifications. It opens a disposable
native fixture thread in 1440x1000, 375x812 and 768x1024, in light/dark themes;
checks English document language, rendered Markdown/file-link href/title/text,
and draft persistence after reload. Expected: six successful cases and
`output/playwright/maintenance-ui.json` plus matching screenshots. No real server
state is used or changed. Cleanup: browser contexts close automatically; generated
output can be deleted. This does not replace live transfer/approval/reconnect tests.

For generator maintenance, run `pnpm run generate:project-file-protocol` twice;
the second run must leave the protocol diff unchanged. Run the full typecheck,
unit, build and integration fixture sequence. CLI is ESM: use
`node dist-cli/index.js --help`, not a fabricated CJS require API.

The fixture also opens the actual Skills management route at desktop size in
both themes, reads SKILL.md details and asserts disable/enable RPC payloads and
native paths. Expected additional artifacts: maintenance-skills-light.png and
maintenance-skills-dark.png. No live Skills configuration is written.

## Desktop controller ownership regression

Prerequisites: installed dependencies; no live server or credentials required.
Run `pnpm exec vitest run src/composables/useDesktopState.test.ts src/composables/useDesktopState.messages.test.ts`.
These fixtures exercise the composed approvals, history, turns and connection
controllers: deferred reads across stop/restart, reconnect during pending approval,
stream repair, uncertain sends, pagination and fork/revert stage boundaries.
Expected: one notification owner, stale reads do not publish, destructive requests
are not replayed, and all cases pass. Test scopes stop polling and clear timers;
no user-state cleanup is required. This is mocked lifecycle verification.

## UI responsibility extraction regression

Prerequisites: dependencies and Playwright Chromium installed; verify 4173 belongs
to this checkout before reusing it. Run `node scripts/test-maintenance-ui.cjs`
(with PLAYWRIGHT_BROWSERS_PATH if using a nondefault browser cache).
All HTTP responses and WebSocket notifications are disposable fixtures.

Actions performed by the harness:

1. Open the conversation in light/dark at 1440x1000, 375x812 and 768x1024;
   inspect Markdown and file-link href/title/text, then reload a saved draft.
2. Attach a disposable file, reload, dispatch an IME Enter and then explicitly
   send. Expect the attachment to survive refresh, IME to send nothing, and the
   explicit action to produce exactly one turn/start including the file.
3. Deliver a streaming delta, completion and reconnect-ready notification.
   Expect the visible response to survive reconciliation without another send.
4. On desktop, pin/unpin, open/cancel Rename, filter/clear search, wait for the
   native second page, and select that row then return to the source route.
5. Switch to an isolated browser connection-profile namespace and back. Expect
   an empty isolated draft and restoration of the original namespace's draft.
6. Open Skills details and disable/enable the fixture skill in both themes.

Expected: all assertions pass; screenshots and per-case request counts appear in
`output/playwright/maintenance-ui.json` and the existing testchat-maintenance and
maintenance-skills screenshot paths. Browser contexts close automatically.
Delete generated output if no longer needed; no real Projects, pins, files,
credentials or conversations are modified. This is mocked acceptance, not an
independently managed authenticated Codex server test.

Focused boundary checks:
`pnpm exec vitest run src/appOrchestration.test.ts src/components/content/composerAttachments.test.ts src/components/content/ThreadComposer.submission.test.ts src/components/content/ThreadConversation.test.ts src/components/sidebar/SidebarThreadTree.test.ts`.
They cover dialog cancellation during preparation, single pending confirmation,
serialized route selection, failed-send navigation, stale upload sessions,
clipboard text/image coexistence, cache work, viewport ownership and native
Sidebar ordering. Tests use disposable state and remove their listeners/timers.
