# Native history and attachment-send recovery

## Ownership and pagination

Thread discovery and ordering come from the connected Codex server. The active
`PersistentThreadIndex` does not augment `thread/list`, inject missing rows, or
provide a separate project/section ordering source.
`POST /codex-api/thread-index/rebuild` remains unavailable (501).

History pages use `AppServerClient.readThreadPage()` and native
`thread/turns/list`, a bounded metadata-only index for absolute turn positions,
opaque cursors and invalidation/race guards. The index retains at most 16 threads,
with a 2-second TTL, bounded page/byte scans and coalesced page requests.
There is no full-history pagination fallback for unsupported servers. See the
[required capability contract](native-project-migration.md).

Recovery snapshots and buffered errors remain available for recognized empty
rollout failures and pending materialization. Portable Fork still needs complete
history through its own transfer path; removing the unused full-history page
cache does not change that path.

## Durable attachment intent

`src/server/persistentThreadIndex.ts` still reads and updates
`codexapp-thread-index.json` in the profile-scoped application state directory.
Do not delete this file to repair visibility: it can contain an unresolved send
intent. Writes use locking and atomic replacement; no migration or deletion is
part of this cleanup.

Only `pending` (token, exact text and previous turn IDs) and `firstTurnId` are
written for recovery. Old `thread` snapshots (including preview, name and
timestamps), `archived` and `deleted` fields are neither read for presentation nor
updated. Existing fields and unrelated recovery records survive writes unchanged;
new records contain no list metadata. There is no format conversion or retention
change. Project/pin upgrade guards read the profile global-state file instead,
not this recovery file.

Explicit attachment references reach Codex in the file-reference envelope.
The request after `## My request for Codex:` stays empty for file-only submissions;
display labels are never added as instructions. For an attachment-only first
turn, the index persists a token, exact input and previous turn IDs before
submission. A confirmed response records the first turn; a matching later history
read can reconcile an ambiguous outcome. Protocol rejections clear the intent,
while transport failures retain it. The application never automatically replays
an ambiguous submission. Pending optimistic rows reconcile with native history;
inspect that history before a deliberate retry.

Native listing may omit injected-only imported conversations until an ordinary
turn is accepted. This upstream limitation does not authorize restoring a custom
listing index. Imported transcripts and transfer receipts remain available through
their existing destination-ID flow. See
[maintenance evidence](maintenance-cleanup.md#portable-discoverability-acceptance-comparison).

## Costs and verification

Native pagination hydrates only requested turn items, with bounded metadata scans.
Attachment intent persistence can require a full history read when the recently
started thread is unavailable in memory; reconciliation uses existing history
responses and serializes local file updates. Native rename/archive/delete and
ordinary turn responses without history no longer read or lock the index just to
maintain redundant list fields. Confirmed sends still write intent then confirmation;
reconciliation only locks when a returned history has pending intent. The bounded
64-entry recently-started map, whole-file locked updates and atomic rename remain.
No polling, duplicate RPCs, unbounded fanout or cache invalidation path is added.
This is code-path analysis; no live latency benchmark was performed.

Verify attachments, empty requests, reloads, reconnects and duplicate submission
protection using the [manual procedure](../tests/chat-composer-rendering/attachment-only-thread-persistence.md).
Unit coverage lives in `persistentThreadIndex.test.ts`,
`remoteHistoryPager.test.ts` and the HTTP history/recovery suites. Fixtures do not
establish live authenticated server behavior.
