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
6. Repeat with a relative or Codex-owned upload root. Expect a clear
   `CODEXUI_REMOTE_UPLOAD_DIR` error and no writes under Codex home.
7. Use a disposable OS account on the App Server host and set its
   `CODEX_HOME` to a separate absolute directory. Use a different home on the
   WebUI backend, preferably on a separate host. Use a fresh profile ID and an
   App Server account where the default upload root is absent. Unset
   `CODEXUI_UPLOAD_CAPACITY_BYTES` and `CODEXUI_REMOTE_UPLOAD_DIR`. Restart the
   backend and upload a file. Verify the directories are created and contain
   the original bytes at the following paths under the App Server account.

   - Linux and macOS use `~/.local/share/codex-webui/uploads/codexapp-uploads/<sha256(ID)>/`.
   - Windows uses `%USERPROFILE%\.local\share\codex-webui\uploads\codexapp-uploads\<sha256(ID)>\`.

   Verify that Codex home stays untouched. Repeat with an empty override and a
   whitespace-only override. On Windows, also try a custom Codex home on a
   different drive from the account's profile directory. Set Codex home to the
   default upload root on the disposable App Server and repeat with no override.
   Expect an error and no directory creation or file writes under Codex home.
8. Use a fixture that rejects the OS home lookup or returns a relative path.
   Leave the override empty and upload. Expect an error naming
   `CODEXUI_REMOTE_UPLOAD_DIR` and no remote writes or new accounting records.
   Restart with the explicit absolute root from step 4 and verify the upload
   succeeds without a home lookup.
9. Set the override to the absolute path of the former `.codex-webui-uploads`
   directory under the disposable App Server account's home. Submit an
   attachment in a conversation and save another in a draft. Clear the
   override and restart with the same App Server ID. Verify the conversation
   and draft attachments still resolve via their saved absolute paths. Upload
   a new file and verify it lands in the new default root and both sets of
   records appear in the profile inventory and journal.

Credential-free API entry-point coverage runs with
`pnpm run test:integration:fixture`, and with `CODEXAPP_FIXTURE_TRANSPORT=unix`
on Linux/macOS. OS resolver and filesystem behavior are covered in
`appServerClient.rpcLifecycle.test.ts`, `connectionProfile.test.ts`,
`remoteUploads.test.ts`, `appAssets.test.ts`, and `rolloutGenerationMetadata.test.ts`.

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
