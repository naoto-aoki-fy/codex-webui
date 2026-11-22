### Feature: Rollout-derived historical model and reasoning metadata

Requirement: [CAP-003](../../docs/product-requirements.md#cap-003-historical-response-metadata).
Active automated coverage: `src/server/rolloutGenerationMetadata.test.ts`,
`src/server/turnGenerationMetadata.test.ts` and `src/turnGenerationMetadata.test.ts`.
These fixtures do not establish live provider acceptance.

Prerequisites: independently managed App Server with filesystem APIs, two completed
turns using different models/efforts, and a disposable test conversation. Do not
edit original rollout files. See [architecture](../../docs/turn-generation-metadata.md).

Actions and expected results:
1. Open the conversation with its rollout-cache entry absent. Response labels
   eventually match native `turn_context` evidence; the compact persistent cache
   is created under the local WebUI cache root at
   `app-servers/<sha256(ID)>/model-history/v2/<sha256(threadId)>.json`.
   Missing fields display unknown.
2. Reload and restart the web backend, then reopen. The cache is validated by
   source stat and reused; no unchanged rollout transfer occurs.
3. Complete another turn and reopen. A changed rollout refreshes the cache and
   shows the new turn's actual model/effort. Changing the composer selection alone
   never changes historical labels.
4. Deny rollout reads or use malformed/unavailable metadata in a fixture. History
   still loads and no selected setting is fabricated. Restore permissions.
5. Submit a turn and observe notifications. No independent
   `codexapp-turn-metadata` file is created or changed; old stores remain intact.
6. Perform Native Fork, Portable Fork and Fork and Revert. Verify source content
   remains unchanged, imported content stays visible after reload, and Fork and
   Revert restores the chosen prompt for editing. Fork metadata comes only from
   the destination rollout; missing inherited evidence displays unknown.
7. Using a controlled fixture, compare missing effort, explicit null and `none`.
   Expect unknown, unspecified and the recorded value to remain distinguishable;
   no case may fall back to the current composer effort.
8. Check labels in light and dark themes, with an older history page and another
   thread containing different metadata. Values must not leak across threads.

Cleanup: archive only disposable conversations. Restore permissions/theme and
network conditions. Do not delete original rollouts or old metadata stores.

## Legacy cache preservation

Use a disposable WebUI profile and thread with validated execution metadata.
Under the local WebUI cache root, put a formatted version 1 fixture at
`app-servers/<sha256(ID)>/model-history/v1/<sha256(threadId)>.json`. Keep an
exact copy outside the cache and start without the corresponding `v2/` file.

1. Open the thread and wait for its response metadata. Compare the legacy file
   against the copy byte for byte. Inspect the new `v2/` file for version 2 and
   the validated rollout metadata.
2. Submit a prompt in Plan mode. Compare the legacy file against the copy again.
   Verify the new file records `submittedModes[turnId] = "plan"` using the
   acknowledged turn ID. Restart WebUI with rollout reads blocked and reopen
   the thread. The Plan badge should appear on that prompt.
3. Use a second disposable thread with a valid version 2 snapshot at the legacy
   path and no preferred file. Reopen it and inspect recovery RPCs. Expect one
   metadata-only `thread/read` and one `fs/getMetadata`, with no `fs/readFile`.
   Submit another Plan turn and verify the accepted mode is added to the same
   file under `v1/` and no file appears under `v2/`.
4. Run `pnpm run build` and `pnpm run test:integration:fixture`. With a version 1
   fixture in place, the backend test pauses the rollout read, submits a Plan
   turn and releases the rollout. Expect the saved version 2 snapshot and the
   accepted mode in the same file, a byte-identical legacy file, and no rollout
   transfer on the next history read. The fixture also checks that an older
   submitted mode contradicted by execution evidence stays cleared.

Cleanup: remove the disposable WebUI profile and fixture copies, archive the
test threads and restore rollout access.

## Plan mode on the submitted prompt

Use the same external App Server and disposable history described above. The
browser fixture at `node scripts/test-turn-mode-history.cjs` covers light and
dark themes at 1280 × 900, 768 × 1024 and 375 × 812.

1. Send identical text in Default and Plan modes. Check that Plan is visible on
   the optimistic Plan prompt before approval or turn completion and remains on
   that exact native prompt when it replaces the optimistic row. Check that
   Default has no badge. Repeat with a file-only prompt and with **Implement**
   on a plan while the composer is set to Plan. Inspect the collaboration mode
   in each `turn/start` call and compare it with the prompt row.
2. Hold the start acknowledgment, reject the request, or return a response
   without a turn ID. Check that the optimistic badge clears when acceptance
   cannot be confirmed. Check that the browser sends a single start and does
   not assign the badge to another prompt with identical content.
3. Reload, restart WebUI and revisit an older turn. Observe an accepted WebUI
   Plan turn with rollout reads unavailable, then enable rollout access. In
   the fixture, make `task_started` and `turn_context` disagree for that ID.
   Check that the badge clears and the submitted fallback stays cleared after
   a restart. For an unrelated turn with neither exact evidence nor a saved
   explicit mode, check for the ordinary prompt bubble.
4. Load an older page before briefly disconnecting the browser stream. Reconnect
   without reloading and confirm the older badge can be recovered through the
   same history request. Verify assistant model, effort and the Sent/Answered
   timestamps before and after. Check destination-owned evidence on Native Fork
   and that Portable Fork retains its ordinary transcript attribution.
5. Archive the disposable threads and remove temporary fixture profiles when done.

### Cached Plan badges with a blocked rollout

1. Build WebUI and run `pnpm run test:integration:fixture`. The fixture seeds
   accepted modes, pauses the remote rollout file read, and requests normal
   history with a retained older turn. Expect exact submitted-mode updates while
   the remote read is still paused. The wire should show one native page for the
   history request and one existing asynchronous rollout recovery.
2. With the current Vite checkout running on port 4173 and Playwright Chromium
   installed, run `CODEXAPP_FIXTURE_BROWSER=1 pnpm run test:integration:fixture`.
   A fresh browser should show the recent Plan badge while the rollout is held.
   Click **Load earlier messages** and check the older Plan badge. The fixture
   compares native history calls with browser requests and checks that the
   pending rollout transfer is shared.
3. Release the rollout with disagreeing execution modes for the older turn.
   Expect the older badge to disappear, the recent badge to remain, and the
   discarded fallback to stay absent on the next history read. Run
   `pnpm exec vitest run src/server/rolloutGenerationMetadata.test.ts` to check
   recovery with a full queue and a cache read that finishes after the conflict.
4. Close the fixture browser and leave the current checkout's Vite server running.
   The fixture removes its temporary profile data automatically.
