# Remote Codex home discovery and WebUI storage ownership

Set up disposable App Servers with distinct custom homes, explicit App Server IDs
and a dedicated absolute `CODEXUI_REMOTE_UPLOAD_DIR` on the App Server host.
Keep the WebUI backend's OS storage root and any local Codex home separate.
Use fixtures for missing, invalid, or delayed handshake metadata and trace
filesystem RPCs separately from other requests.

1. Upload before opening a thread and delay initialization. Expect upload RPCs
   only after the handshake, to the configured attachment directory and ID
   namespace. Expect zero `config/read` discovery requests. Repeat with an
   explicit upload directory inside the initialized home and confirm rejection
   before any filesystem RPC.
2. When handshake home metadata is missing, open a thread with a native
   `sessions/YYYY/MM/DD/rollout-*.jsonl` or `archived_sessions/rollout-*.jsonl`
   path. Verify that existing read can supply the home. Before any usable read,
   concurrent metadata recovery shares one `config/read` discovery request,
   using the base user layer's path.
   Before opening any thread, try an upload with a fixture that reports
   a custom Codex home through that layer. A directory inside the custom
   home must be rejected before filesystem requests. Repeat with an empty
   layer list and expect a Codex-home configuration error. Then report a
   valid home and configure a symbolic link to that home as the upload root.
   Expect only read-only metadata requests and no inventory reservation.
3. Reconnect with different initialization metadata. Verify the new home
   replaces the previous value, and delayed responses from the previous
   connection do not change it.
4. For CAP-003, reopen and paginate older responses. Check metadata stays
   associated with the correct turn. Inspect the rollout cache under the
   backend's OS cache directory and repeat after restarting with the same ID.
   Expect four cold metadata RPCs, then two on an unchanged restart, including
   one rollout transfer in total and no remote filesystem writes. Stage an
   independent ID with identical thread IDs, paths, and modification timestamps
   to verify cache entries are isolated.

Cleanup: stop disposable processes and remove only temporary homes and WebUI
storage. Automated coverage lives in `codexHomeResolver.test.ts`,
`appServerClient.rpcLifecycle.test.ts`, and `rolloutGenerationMetadata.test.ts`.
