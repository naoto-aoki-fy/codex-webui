# Native thread history and attachment sends

## History and recovery

Thread discovery and ordering come from the connected Codex App Server.
History pages use native `thread/turns/list` with opaque cursors and
`AppServerClient.readThreadPage()` for absolute turn positions. The paging
adapter has bounded metadata scans, request coalescing and invalidation.
See the [required server capabilities](native-project-migration.md).

The WebUI retains browser optimistic rows and bounded in-memory recovery
snapshots for transient failures. Active subscriptions resume after an upstream
reconnect. Native history is the durable source for accepted turns, attachments
and thread discovery. An injected-only Portable Fork destination may be absent
from listing until its first ordinary turn. The imported transcript remains
available by destination ID. See the [recorded discovery checks](maintenance-cleanup.md#portable-discoverability-acceptance-comparison).

## Attachment-only submissions

Files are sent as references in the input. An attachment-only file submission
keeps the request after `## My request for Codex:` empty. Native image inputs,
ordinary text, and optimistic row reconciliation use the existing composer flow.
When the App Server acknowledges a turn, the WebUI can associate the optimistic
row with that turn ID and replace it with the native row as history arrives.

The WebUI forwards each submitted turn once. On a lost response or timeout, the
open UI can show that delivery is uncertain. Reload or reopen the conversation
by ID to see whatever Codex persisted. Missing history is insufficient evidence
that the request failed. Submitting again is a new attempt and can duplicate
execution. This also applies if the server reports that the thread must be
reopened before sending.

The previous first-attachment journal could retain an unresolved request across
a WebUI restart, block another matching workflow on that thread, and reconcile the
stored intent against a later native turn. Those cross-restart guarantees are gone.
The WebUI now leaves `codexapp-thread-index.json` and its scratch files untouched.
If Codex never persisted a new thread or its first turn, the WebUI cannot
reconstruct it from a journal. Existing native history and uploaded file references
remain subject to the connected server and filesystem. Native queue receipts in
IndexedDB cover the separate Queue operation.

## Costs and verification

Attachment-only sends use the same native dispatch as other turns. The bridge
does zero index file reads, locks or writes and performs no history preflight
to capture previous turn IDs. Native subscription recovery and history paging
retain their existing request behavior. Live delivery and restart latency were
not measured for this cleanup.

See the [attachment and reconnect checks](../tests/chat-composer-rendering/attachment-only-thread-persistence.md)
for test setup, optimistic rows, reload, lost acknowledgments and deliberate
resubmission.
