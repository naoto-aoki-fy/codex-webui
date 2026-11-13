# Conversation transfer

“Fork conversation” and “Fork from this response” snapshot the source history,
then ask for a configured destination provider/model. Cancel creates no thread.
The snapshot is read directly from the connected app-server with
`thread/read { includeTurns: true }`, bypassing the browser's ten-turn page.
Response transfers retain the selected turn inclusively. Active source turns
must finish or be stopped first. Activity after snapshot capture is excluded.

After selection the backend calls `thread/start` with the source working
directory and selected provider/model, verifies the effective selection, then
awaits `thread/inject_items { threadId, items }`. It never calls native fork,
`turn/start`, or resends a failed prompt. Normal configured new-thread
instructions come from the destination app-server. Edit/retry/revert retain
their existing native cutoff semantics.

## Portable history

The converter constructs new Responses `message` items, using `input_text`
for user text and `output_text` for assistant text. It preserves message order
and text without summarizing. Command output and text MCP observations become
labeled historical user text, never executable calls or live results.

Images, attachments and unknown user content become explicit placeholders.
Reasoning (including encrypted reasoning), tools/declarations, source IDs,
continuation metadata, privileged instructions and unsupported item types are
excluded with warnings in the destination picker. No destination has been
verified here to accept transferred binary content. The initial request budget
is 8 MiB; larger histories fail before creation. A destination can impose a
smaller context limit, which is reported as an import failure, never silently
truncated by the app.

## Persistence and failure recovery

Profile-scoped Codex global state stores the snapshot, source attribution,
destination ID and import stage atomically. Injected model context is persisted
by the connected app-server; the local imported transcript is independently
included in read/resume/page responses for presentation after reload. Imported
assistant messages are labeled with their source, not credited to the new model.
Subsequent transfers include this prefix once. Imported response cutoffs use
negative transcript positions; native turn indices remain unchanged.

The transfer ID is single-use. A durable stage transition fences creation and
injection before either request. Duplicate submissions are rejected. A timeout
or lost acknowledgment is ambiguous: injection is never automatically retried.
The error identifies the destination (when known) and stage. Reopened incomplete
destinations show an error and the backend blocks `turn/start`. Source and
composer draft are preserved. Inspect the incomplete destination and archive
it explicitly if unwanted; a new transfer must be a deliberate new operation.
A lost browser acknowledgment is reconciled by reading the durable transfer
receipt, without repeating creation or injection.
A disconnect during `thread/start` may leave a destination whose ID was never
acknowledged; inspect the app-server thread list.

An unsupported `thread/inject_items` produces upgrade/capability guidance;
there is no native-fork fallback. The connection already enables experimental
API support. Schema acceptance and provider compatibility depend on the
independently managed server, not the bundled development dependency.

## Verification and performance

`conversationTransfer.test.ts` covers conversion, full history beyond the UI
page, stable cutoffs, cancellation, persistence decoration without reinjection,
repeated transfers, default-selection rejection and failure/timeout fencing.
A 2,000-turn conversion audit produced 4,000 messages (365,781 bytes) in
10.18 ms locally, with zero RPCs during conversion. This does not measure
remote injection latency or browser rendering.

Desktop state tests cover both entry points, delayed publication, duplicate
clicks and the next explicit submission. These are mocked protocol tests, not
live provider validation. A fresh destination runtime may still generate an
unsupported request independently of imported history.

The transfer path uses one full source read, one start and one injection; it
performs no RPC per message and no automatic retry or tool execution. Conversion
is linear in selected history size. The 8 MiB request budget rejects rather
than truncates. Transcript storage and presentation are also linear in imported
history; the existing atomic global-state store grows with retained imports.
Read/resume decoration performs an asynchronous state read and no extra remote
RPC. Large-history browser rendering and live context retention need validation
against the deployed server/providers.
