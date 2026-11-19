# Connection profiles and upload accounting

## Profile isolation

Prerequisites: disposable local CODEX_HOME and fixture server, never existing user state.

1. Start with no explicit profile and set a Home model preference.
2. Restart with `--connection-profile one` against the same fixture URL and set a different Home model preference.
3. Restart with `--connection-profile two` and confirm it starts with the fixture defaults. Repeat with profile `one`, then with no explicit profile.

Expected: each profile restores its own choice on Home. The default `legacy`
profile uses the preference file directly under `CODEX_HOME`. Global WebUI
password sessions remain shared. Automated coverage lives in
`src/server/connectionProfile.test.ts` and `src/server/modelPreferencesStore.test.ts`.

Cleanup: stop only disposable servers and delete the disposable state directory.

## Upload inventory, retention and capacity

Prerequisites: disposable remote fixture filesystem and local state directory, `CODEXUI_UPLOAD_CAPACITY_BYTES=4`.

1. Seed a historical journal entry with unknown size, stage three bytes using profile one, then attempt two bytes using profile two.
2. Remove only the disposable fixture's `codexapp-upload-inventory.json`. Retry
   the two-byte upload, then upload one byte and read the recovered inventory.
3. In a separate fresh fixture, simulate a lost write response, then inspect
   the inventory and remote mutation log.

Expected: the two-byte attempts are rejected before `fs/writeFile`. The recovered
inventory retains the historical path, the three-byte reservation with its
journal status of `unknown`, and the new one-byte reservation. Ambiguous writes
retain their byte reservation. The remote log contains no `fs/remove` call.
Automated coverage lives in `src/server/remoteUploads.test.ts`.

Cleanup: remove disposable fixture files and local state only. Real two-host verification remains required for filesystem quota behavior and authentication; fixture results do not establish remote quota enforcement or live reference recovery.

## Browser profile transition

Prerequisites: current disposable verification server on 127.0.0.1:4173. Run `node scripts/test-connection-profiles.cjs`; it intercepts API requests and supplies synthetic notification sockets. Expected: different-profile ready reloads once, colliding thread IDs have separate drafts, returning to legacy restores its draft, and same-profile ready does not reload. Light/dark screenshots land under `output/playwright/connection-profiles-*.png`. No real remote operations occur. Disabled-storage reload-loop coverage is in `src/utils/browserConnectionProfile.test.ts`. Cleanup: close fixture pages; keep the verification server running.
