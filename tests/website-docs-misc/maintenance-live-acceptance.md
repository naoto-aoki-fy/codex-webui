### Feature: Maintenance acceptance against a disposable live dataset

Prerequisites: an independently managed POSIX Codex App Server with matching
credentials and filesystem, Project, pagination, inject-items and revert APIs.
Record its initialization version. The test creates small real model turns using
its default provider; never use an existing user conversation as the source.
Use a disposable local application home: the harness seeds its global state.

Setup and actions:
1. Inspect any listener on 4173 and its cwd. Start this checkout there with a new
   temporary local CODEX_HOME; leave the independently managed Codex server and
   the persistent 5173 server alone. Use that same temporary path as
   MAINTENANCE_STATE_HOME below. Install Chromium in a writable temporary browser
   cache if necessary (`PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright pnpm exec
   playwright install chromium`).
2. Run:

   ```sh
   PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright \
   CODEX_MAINTENANCE_LIVE=1 \
   MAINTENANCE_STATE_HOME=/tmp/<disposable-application-home> \
   MAINTENANCE_BROWSER_BASE_URL=http://127.0.0.1:4173 \
   pnpm exec vitest run src/server/maintenance.live.test.ts
   ```

3. Inspect `output/playwright/maintenance-live.json`, the light/dark screenshots,
   and `maintenance-fork-revert-draft.png`. Expect native create/import idempotency,
   name/root updates, ordering, association and deletion; repeatable migration
   including an empty project and a genuinely pre-existing imported transcript.
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

### Feature: Read-only Project/pin upgrade safeguards

Prerequisites: repository dependencies and disposable temporary state only; no
credentials, native database or real user files. Run:

```sh
pnpm exec vitest run src/server/nativeProjects.test.ts src/server/nativeUpgradeAcceptance.test.ts src/server/threadPresentationStore.test.ts src/server/projectHistory.test.ts src/server/workspaceRootsStore.test.ts src/server/connectionProfile.test.ts
```

Actions: fixtures read fresh state, populated native Projects alongside legacy
roots, interrupted and completed receipts, empty/meaningful legacy pins, a receipt
for another connection, malformed JSON, an invalid top-level object and an
unreadable state path (a directory, producing EISDIR). Completed cases retain
legacy fields and an unrelated backup object. Exercise native create, rename,
move and delete plus paginated pin reads and profile isolation.

Expected: incomplete Projects and remaining legacy pins are independently blocked
with upgrade instructions even when native records exist. Completed/fresh native
installations remain usable; errors remain errors, and stored bytes are unchanged.
Ordinary native conversation reads remain available when upgrade guards reject.
The API gateway unit suite additionally checks pin/unpin native section moves.
These are mocked RPC/isolated filesystem checks, not authenticated migration tests.
Cleanup: tests remove their temporary directories and restore environment variables;
no user-state rollback or migration is performed.
