# Conversation transfer

Both “Fork conversation” and “Fork from this response” open the same picker.
Choose **Portable Transfer** (the default) or **Native Fork** before confirming.
Cancel creates no thread. Duplicate confirmations are blocked while either
method is pending. Switching methods does not automatically create anything.

- **Native Fork** uses the original provider and server-managed native thread
  state. There is no destination provider/model selection, injection, or automatic
  provider-switching re-fork. Full forks call `thread/fork`; response forks use the
  existing native inclusive `lastTurnId` mechanism and verify the retained turn
  IDs against durable history. The selected response identity is checked before
  forking, so a stale cutoff fails instead of selecting a different response.
- **Portable Transfer** creates a new conversation from normalized readable
  history and lets you select a destination provider/model first. It is available
  for same-provider transfers as well as cross-provider transfers.

Native errors are independent of portable preparation/import errors. An
unsupported native API produces a native-fork capability error; the app never
silently falls back to transfer. A failed or uncertain native request is not
replayed automatically. Inspect the thread list before deliberately retrying.
Native forks have no local imported-transcript decoration or import guards,
including after reload. Their presentation is owned by the app-server.

Imported-only responses have no native turn ID. Their Native Fork option shows
an explanation and cannot be confirmed; use Portable Transfer for that cutoff.
A whole native fork of an imported thread relies on the app-server's stored
context and presentation. Use Portable Transfer to retain the app's visible,
attributed imported transcript in the new conversation.

## Portable transfer lifecycle

Portable mode snapshots the source history before provider/model confirmation.
Its filtering, persistence and failure fencing are unchanged.
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

The picker prepares one portable snapshot by default and reuses it across method
changes. Native creation is independent of that pending preparation and its
limits. Cancel or successful native creation discards the unused snapshot;
late preparation results are also cleaned up, without creating a thread.
Method changes do not reread or recalculate history. This preserves stable
portable cutoffs but means choosing Native Fork can still incur the default
portable snapshot read/conversion. There is no new startup work, per-message
RPC fanout, or native cache invalidation mechanism. Native full creation uses
one fork RPC plus normal list/resume hydration; native response creation adds
the existing source read and durable cutoff verification read. Live remote
latency and large-history rendering were not measured for this follow-up.

The transfer path uses one full source read, one start and one injection; it
performs no RPC per message and no automatic retry or tool execution. Conversion
is linear in selected history size. The 8 MiB request budget rejects rather
than truncates. Transcript storage and presentation are also linear in imported
history; the existing atomic global-state store grows with retained imports.
Read/resume decoration performs an asynchronous state read and no extra remote
RPC. Large-history browser rendering and live context retention need validation
against the deployed server/providers.

The mocked browser matrix can be rerun against the current worktree's dev server
at `http://127.0.0.1:4173` with `node scripts/test-fork-methods.cjs`. It covers both
entry points and methods, cancel/draft preservation, double confirmation,
light/dark themes, native versus imported reload presentation, one explicit
continuation, native operation after portable preparation failure, and explicit
portable selection after a native capability error. The portable service call
is mocked at the browser boundary; server unit tests verify start/inject order.
Screenshots and the request report are saved under `output/playwright/`.
