# Connection profiles and upload accounting

## Profile isolation and legacy migration

Prerequisites: disposable local CODEX_HOME and fixture server, never existing user state.

1. Write legacy workspace roots to `.codex-global-state.json`.
2. Start with `--connection-profile one`, add `/remote/one`, restart with profile `two` using the same WebSocket URL, and add `/remote/two`.
3. Restart each profile and inspect workspace settings. Repeat switching twice.
4. Start with no explicit profile.

Expected: named profiles retain only their respective roots; default `legacy` retains the original roots; repeated startup performs no copying. Global authentication state remains shared. Automated coverage: `src/server/connectionProfile.test.ts` and existing workspace-store concurrency/atomic-write tests.

Cleanup: stop only disposable servers and delete the disposable state directory.

## Upload inventory, retention and capacity

Prerequisites: disposable remote fixture filesystem and local state directory, `CODEXUI_UPLOAD_CAPACITY_BYTES=4`.

1. Seed a legacy journal entry with unknown size, stage three bytes using profile one, then attempt two bytes using profile two.
2. Request `GET /codex-api/uploads` with the same HTTP authentication used by the app.
3. Simulate a lost write response, inspect again, and inspect the remote fixture's mutation log.

Expected: the second write is rejected before `fs/writeFile`; accounting lists shared profile records and unknown legacy sizes, reports only tracked bytes, and protects every record. Ambiguous writes retain reservation. Cleanup preview is empty, unsupported reason explains missing reference proof, and no `fs/remove` is called. Existing uploads are never test targets. Automated coverage: `src/server/remoteUploads.test.ts`.

Cleanup: remove disposable fixture files and local state only. Real two-host verification remains required for filesystem quota behavior and authentication; fixture results do not establish remote quota enforcement or live reference recovery.

## Browser profile transition

Prerequisites: current disposable verification server on 127.0.0.1:4173. Run `node scripts/test-connection-profiles.cjs`; it intercepts API requests and supplies synthetic notification sockets. Expected: different-profile ready reloads once, colliding thread IDs have separate drafts, returning to legacy restores its draft, and same-profile ready does not reload. Light/dark screenshots land under `output/playwright/connection-profiles-*.png`. No real remote operations occur. Disabled-storage reload-loop coverage is in `src/utils/browserConnectionProfile.test.ts`. Cleanup: close fixture pages; keep the verification server running.
