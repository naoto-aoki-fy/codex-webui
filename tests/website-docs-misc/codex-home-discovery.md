# Connected Codex home discovery

Setup: use disposable App Servers/profiles with distinct custom remote homes.
Set WebUI `CODEX_HOME=/webui/state` (or a disposable equivalent), distinct from
the server's `/server/state`. Unset `CODEXUI_REMOTE_UPLOAD_DIR`. Observe App
Server RPC traffic. Local WebUI state must stay in its existing local location.
Use protocol fixtures for missing/invalid/delayed handshake metadata.

1. Start with an upload before opening any thread, delaying initialization in the
   fixture. Expect no upload RPCs before handshake completion. Return server
   `codexHome=/server/state`; expect uploads under `/server/state/codexapp-uploads`
   and zero discovery `config/read` requests. The server's default effective home
   is accepted even without an explicitly configured server `CODEX_HOME`.
2. With missing or invalid handshake metadata, open an existing thread whose read
   response includes `sessions/YYYY/MM/DD/rollout-*.jsonl` or
   `archived_sessions/rollout-*.jsonl`. Upload an attachment. Expect zero discovery
   requests; the existing read supplies the home despite WebUI `CODEX_HOME`.
   Alternatively upload concurrently before any usable thread read: expect one
   shared discovery `config/read` with `includeLayers: true`. Only the base user
   layer supplies the remote home; later uploads reuse it. Invalid metadata or
   failed discovery leaves the home unresolved and allows a later retry.
3. Reconnect to a server with a different home. Expect the new handshake home to
   replace the previous cache, with zero discovery reads. Delay old handshake,
   thread and config responses in fixtures; they must neither populate an empty
   new cache nor overwrite its value. Repeat with a profile change.
4. Set `CODEXUI_REMOTE_UPLOAD_DIR` explicitly. Expect uploads there without home
   resolution. WebUI-local state still uses its existing local storage rules.
5. For CAP-003, reopen and paginate historical responses. Verify models/efforts
   remain associated with their exact turns; missing evidence stays unavailable.
   Check rollout caches remain under the resolved remote home.

Automated coverage: `codexHomeResolver.test.ts`,
`appServerClient.rpcLifecycle.test.ts`, `remoteUploads.test.ts`, and
`rolloutGenerationMetadata.test.ts`. Fixtures cover invalid metadata/retries,
delayed initialization, obsolete handshakes, config/thread races, profiles,
Windows drive and UNC paths without local stat.
Count discovery requests separately from unrelated application config reads.

Cleanup: remove only disposable uploads, homes and profiles. Restore environment
variables. Upload retention is indefinite; do not remove files used by real chats.
