# Native history and retired attachment index

Thread discovery and ordering come from the connected Codex server. The old
`codexapp-thread-index.json` implementation and its reconciliation/rebuild logic
are retired. `POST /codex-api/thread-index/rebuild` remains unavailable (501).
Do not use old rebuild instructions or delete historical index files to repair
visibility; this release neither consumes nor rewrites them.

Explicit attachment references still reach Codex in the file-reference envelope.
The request after `## My request for Codex:` stays empty for file-only submissions;
display labels are never added as instructions. Pending optimistic rows reconcile
with native history without replaying submissions. An unknown send outcome needs
inspection of native history before a deliberate retry.

History pages use native `thread/turns/list`, a bounded metadata-only index for
absolute turn positions, opaque cursors and existing invalidation/race guards.
There is no full-history fallback for unsupported servers. See the
[required capability contract](native-project-migration.md).

Native listing may omit injected-only imported conversations until an ordinary
turn is accepted. This pre-existing upstream limitation does not authorize
restoring a custom index. Imported transcripts and transfer receipts remain
available through their existing destination-ID flow. See
[maintenance evidence](maintenance-cleanup.md#portable-discoverability-acceptance-comparison).

Verify explicit attachments, empty requests, reloads, reconnects and duplicate
submission protection using the [manual procedure](../tests/chat-composer-rendering/attachment-only-thread-persistence.md).
