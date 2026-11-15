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
   is created under the remote Codex home. Missing fields display unknown.
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
