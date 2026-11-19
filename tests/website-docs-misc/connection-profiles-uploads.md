# App Server ID, storage, and upload isolation

Use a disposable App Server and a temporary WebUI storage environment. On Linux,
point the four XDG variables at separate absolute directories in the fixture.
Start the App Server with a separate disposable Codex home. Place arbitrary
sentinels in that home, including an old `.codex-global-state.json`, model
preferences, and upload inventory. Use the same endpoint for all test IDs.

1. On a backend host with a valid short hostname, unset `CODEXUI_CONNECTION_PROFILE`
   and run `node dist-cli/index.js --host 127.0.0.1 --port 5900 --no-open`
   with `CODEXUI_APP_SERVER_URL` set to the fixture endpoint. Fetch
   `http://127.0.0.1:5900/codex-api/connection-profile` and confirm the returned
   ID matches `hostname -s` on the backend host (the first hostname label on
   Windows). Stop the CLI, then run `pnpm run dev --host 127.0.0.1 --port 4199`
   and confirm `http://127.0.0.1:4199/codex-api/connection-profile` returns the
   same ID. Repeat with `CODEXUI_CONNECTION_PROFILE=fixture-env` and expect
   `fixture-env`. Add `--connection-profile fixture-cli` to the CLI command
   while that variable is set and expect `fixture-cli`. Start each command
   with `CODEXUI_CONNECTION_PROFILE=../outside` and no profile flag and confirm
   that it exits before serving HTTP with an invalid App Server ID error.
2. Launch with `--connection-profile one` against the fixture endpoint. Choose a
   Home model/mode, save a thread draft, and sign in with WebUI password
   protection enabled. Restart with the same ID and confirm all three persist.
3. Restart with ID `two` at the same endpoint. The model preference and draft
   start empty. The WebUI login session still works. Restart with ID `one` to
   recover its earlier selections and draft. Supply `legacy` explicitly and
   confirm it initializes fresh backend state. The old sentinels retain their
   bytes.
4. Set `CODEXUI_REMOTE_UPLOAD_DIR` to an absolute disposable attachment root on
   the App Server and `CODEXUI_UPLOAD_CAPACITY_BYTES=4` on the backend. On ID
   `one`, upload a three-byte file, then attempt a two-byte upload. The first
   appears under `codexapp-uploads/<sha256(one)>/` on the App Server. The second
   is rejected before the filesystem write.
5. Use ID `two` and upload four bytes. Verify the second namespace has separate
   upload bytes and a separate local `uploads/inventory.json` and
   `uploads/journal.jsonl`. Return to ID `one`, remove its disposable inventory
   only, and retry. Its journal restores the three-byte reservation with status
   `unknown`. Simulate a lost write response and verify its bytes stay reserved.
6. Repeat with a missing or Codex-owned upload root. Expect a clear
   `CODEXUI_REMOTE_UPLOAD_DIR` error and no writes under Codex home.

Credential-free API entry-point coverage runs with
`pnpm run test:integration:fixture`, and with `CODEXAPP_FIXTURE_TRANSPORT=unix`
on Linux/macOS. OS resolver and filesystem behavior are covered in
`connectionProfile.test.ts`, `remoteUploads.test.ts`, `appAssets.test.ts`, and
`rolloutGenerationMetadata.test.ts`.

## Browser restart

On the current verification server at `127.0.0.1:4173`, run
`node scripts/test-connection-profiles.cjs`. This fixture supplies a backend ID
and synthetic notification socket. Verify colliding thread IDs start with
separate drafts, return restores the original draft, and a same-ID ready frame
does not reload. The fixture also checks that a stale URL hint and an unscoped
draft are ignored. Screenshots for both themes land in `output/playwright/`.

Cleanup: close fixture pages, stop the disposable App Server and any disposable
backend other than the reusable verification server, and remove fixture
directories. Preserve any real attachment referenced by a conversation.
