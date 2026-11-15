# Connected Codex home discovery

Setup: use a disposable App Server/profile and a custom remote home name. Unset
WebUI `CODEX_HOME` and `CODEXUI_REMOTE_UPLOAD_DIR`. Observe App Server RPC traffic.
Local WebUI application state must stay in its existing local storage location.

1. Open an existing thread whose read response includes a native
   `sessions/YYYY/MM/DD/rollout-*.jsonl` or `archived_sessions/rollout-*.jsonl` path.
   Upload a small attachment. Expect no home-discovery requests: the existing
   read supplies the home, and uploads use `<home>/codexapp-uploads`.
2. Restart WebUI without opening a thread. Upload attachments concurrently.
   Expect one discovery `config/read` with `includeLayers: true`; the base user
   layer supplies the home even when its config file does not exist. Project,
   system and named-profile layers must not determine it. Later uploads reuse it.
3. Reconnect, then repeat. Expect a fresh discovery if no thread read has supplied
   the home. Responses from the old connection must not populate the new cache.
4. Repeat with explicit `CODEX_HOME`. Expect no discovery RPCs. With an explicit
   `CODEXUI_REMOTE_UPLOAD_DIR`, expect uploads there without resolving the home.
5. For CAP-003, reopen and paginate historical responses. Verify models/efforts
   remain associated with their exact turns; missing evidence stays unavailable.
   Check rollout caches remain under the resolved remote home.

Automated coverage: `codexHomeResolver.test.ts`,
`appServerClient.rpcLifecycle.test.ts`, `remoteUploads.test.ts`, and
`rolloutGenerationMetadata.test.ts`. Fixtures cover invalid metadata/retries,
config/thread races, profiles, Windows drive and UNC paths without local stat.
Count discovery requests separately from unrelated application config reads.

Cleanup: remove only disposable uploads, homes and profiles. Restore environment
variables. Upload retention is indefinite; do not remove files used by real chats.
