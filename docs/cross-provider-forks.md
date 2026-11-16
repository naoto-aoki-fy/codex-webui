# Conversation transfer

Product guarantees: [CAP-001 Fork and Revert and CAP-002 Portable Fork](product-requirements.md).
This document owns current transfer implementation details.

Both “Fork conversation” and “Fork from this response” use the same split-button
pattern as Revert. The main **Fork** button immediately runs **Native Fork**.
Its arrow opens **Native Fork** / **Portable Fork** options without reading
history or creating a thread. Choosing Native Fork from the menu has the same
behavior as the main button. Choosing Portable Fork opens only the existing
provider picker; there is no model or method selector in that dialog.

Canceling the portable picker creates no thread. Duplicate operations are
blocked while either creation path is pending.

- **Native Fork** uses the original provider and server-managed native thread
  state. There is no destination provider/model selection, injection, or automatic
  provider-switching re-fork. Full forks call `thread/fork`; response forks use the
  existing native inclusive `lastTurnId` mechanism and verify the retained turn
  IDs against durable history. The selected response identity is checked before
  forking, so a stale cutoff fails instead of selecting a different response.
- **Portable Fork** uses Portable Transfer to create a new conversation from normalized readable
  history and lets you select a destination provider first. It is available
  for same-provider transfers as well as cross-provider transfers.

Native errors are independent of portable preparation/import errors. An
unsupported native API produces a native-fork capability error; the app never
silently falls back to transfer. A failed or uncertain native request is not
replayed automatically. Inspect the thread list before deliberately retrying.
Native forks have no local imported-transcript decoration or import guards,
including after reload. Their presentation is owned by the app-server.

Imported-only responses have no native turn ID. The main native action and
Native Fork menu option are disabled with an explanatory tooltip. The arrow
remains usable so Portable Fork is still available for that cutoff.
A whole native fork of an imported thread relies on the app-server's stored
context and presentation. Use Portable Transfer to retain the app's visible,
persisted imported transcript and its internal attribution in the new conversation.

## Portable Fork and Revert

A historical user message's existing Revert split menu also offers
**Fork and Revert (Native)** and **Portable Fork and Revert**. The main button
still runs Native Fork and Revert; the in-place Revert action remains separate.
Portable Fork and Revert opens the same provider picker as Portable Fork, with a
matching dialog title and unchanged provider/model defaults.

The portable snapshot identifies the selected user message by its persisted turn
and item IDs. It reads the complete server history, including unloaded older turns,
and retains only turns **before** the selected user turn. The selected message,
its response and all later turns are excluded. This matches native Fork and Revert;
assistant-response Portable Fork cutoffs remain **inclusive**. A previously imported
prefix is retained once. Imported-only user messages without a native turn boundary
have the same eligibility limitation as existing Fork and Revert.

The selected prompt is normalized using the same user-message presentation rules
as native draft restoration, then saved separately in the durable transfer receipt.
It is never included in injected history. After confirmed import (including recovery
of a lost browser acknowledgment), the destination's text is saved as an ordinary,
profile/tab-scoped composer draft **before** selecting the destination. Navigation
and reload use the existing draft hydration path. Later edits and explicit sends
use normal draft behavior; reopening a thread does not reapply the receipt's prompt.
Only text is restored, as with existing Fork and Revert; attachments and skill/app
selections are not recreated. The source history, draft and provider/model settings
are untouched. Nothing submits the draft or starts generation.

Selecting the first user turn creates a draft-only destination with no injected
history. Empty-history rejection for ordinary Portable Fork is unchanged. The
provider/model verification, single-use transfer ID, duplicate-operation guards,
8 MiB history budget and incomplete-destination fencing are shared with Portable
Fork. Cancellation, including during preparation, creates no destination. Failed
or ambiguous creation/injection never falls back to Native Fork or retries a
mutation. Inspect the reported destination before deliberately starting another
operation. Browser storage restrictions retain the existing tab-only draft
fallback and warning; durable reload persistence requires writable browser storage.

## Portable transfer lifecycle

Portable mode snapshots the source history before provider confirmation.
Its filtering, persistence and failure fencing are unchanged.
The snapshot is read directly from the connected app-server with
`thread/read { includeTurns: true }`, bypassing the browser's ten-turn page.
Response transfers retain the selected turn inclusively; Portable Fork and Revert
retains only preceding turns and snapshots the selected prompt separately.
Active source turns must finish or be stopped first. Activity after snapshot capture is excluded.

After selection the backend calls `thread/start` with the source working
directory and selected provider/model, verifies the effective selection, then
awaits `thread/inject_items { threadId, items }`. It never calls native fork,
`turn/start`, or resends a failed prompt. Normal configured new-thread
instructions come from the destination app-server. Edit/retry/revert retain
their existing native cutoff semantics.

## Provider and model controls

Portable Fork requires only a destination provider. The app resolves its model
from provider-scoped default metadata and passes the resulting raw model and
provider explicitly to the existing transfer API. For the server's configured
provider, the configured `model` wins. For other providers, an explicitly
reported provider/catalog default wins, followed by a declared default model,
then the visible catalog's priority order (the Codex picker default convention).
The source thread's model and model usage order never supply this default.
Providers without a usable catalog/default cannot be confirmed. Effective
provider/model verification still runs before injection. No provider defaults
are written or changed by the dialog.

The normal model pickers show only the active provider's models and use model
names without provider prefixes. IDs and provider associations remain qualified
internally. Switching context/provider recalculates the list; a model override
from a previously confirmed provider is discarded. Users can change models
within the destination provider after creation.

The dialog contains no Skills controls and does not load the Skills manager or
write skill configuration. Manage skills through the main Skills Hub and select
skills in the chat composer as usual. Existing skill configuration and composer
draft skill selections are unchanged.

## Portable history

The converter allowlists ordinary `userMessage` text content and `agentMessage`
text, constructing new Responses `message` items with `input_text` for users and
`output_text` for assistants. Message roles, order, Markdown, code blocks and
multiline text are preserved. Separate source messages stay separate; text
chunks inside a user message use the app's normal newline presentation.
Items without readable text do not create empty messages.

Tools, tool results/observations, command logs, reasoning (including encrypted
reasoning), images, attachments, provider execution state, instructions and
unknown item/content types are silently excluded. None are converted to text,
placeholders, summaries or omission notices. The displayed imported transcript
is stored from the same text messages used to build the injection request.
The legacy `warnings` response field remains an empty array for compatibility;
the picker and completion path do not render omission notices.

The initial request budget is 8 MiB; larger histories fail before creation.
A destination can impose a smaller context limit, reported as an import failure,
never silently truncated by the app. Empty text-only histories cannot be imported
by ordinary Portable Fork; a first-turn Portable Fork and Revert can create a draft-only destination without injection.
Existing completed destinations are not rewritten or reinjected by this change.

## Persistence and failure recovery

Profile-scoped Codex global state stores the snapshot, source attribution,
destination ID and import stage atomically. Injected model context is persisted
by the connected app-server; the local imported transcript is independently
included in read/resume/page responses for presentation after reload. Imported
messages display their original text without repeated import labels. Source
attribution remains in the stored transcript and normalized `importMetadata`,
separate from the displayed message text.
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
10.11 ms locally, with zero RPCs during conversion. This does not measure
remote injection latency or browser rendering.

Desktop state tests cover both entry points, delayed publication, duplicate
clicks and the next explicit submission. These are mocked protocol tests, not
live provider validation. A fresh destination runtime may still generate an
unsupported request independently of imported history.

Opening the arrow performs no API work. Native Fork no longer prepares, converts,
or stores an unused portable snapshot. Portable history is read only after
choosing Portable Fork, before destination confirmation; canceled preparation
results are still cleaned up safely. Native full creation uses one fork RPC plus
normal list/resume hydration; native response creation adds the existing source
read and durable cutoff verification read. The shared split button uses the
same ComposerDropdown as Revert. Dropdown options are computed per rendered
button and the existing conversation render window is unchanged. There is no
new startup work, per-message request fanout, blocking filesystem operation,
large request payload, or new cache invalidation mechanism. Browser mocks check
that opening the arrow and choosing native produce zero portable preparation
requests. Live remote latency and large-history rendering were not measured.

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
entry points, main native actions and menu options, cancel/draft preservation,
double confirmation,
light/dark themes, native versus imported reload presentation, one explicit
continuation, native operation after portable preparation failure, and explicit
portable selection after a native capability error. The portable service call
is mocked at the browser boundary; server unit tests verify start/inject order.
Screenshots and the request report are saved under `output/playwright/`.

Message presentation uses the original transcript text directly; it does not
change the stored transcript, injected items or transfer lifecycle. Normalization
still takes one linear pass and preserves stable message IDs/cutoffs. Internal
source metadata participates in message reconciliation, so unchanged messages
can reuse cached objects. This presentation change adds no API requests,
synchronous filesystem work, fanout, or cache invalidation. Live provider latency
was not measured for this presentation refinement.

The provider/model UI uses the already loaded catalog, so provider selection and
filtering add no catalog RPCs or request fanout. Catalog responses now retain
small default-model fields; instruction templates remain excluded. Removing the
embedded Skills manager eliminates its mount, reads and configuration writes
from the dialog, along with its expansion state. The main Skills Hub and composer
paths are unchanged. This removal adds no requests, blocking work, fanout, large
payloads or cache invalidation.
History conversion now excludes non-conversation items; injection retries and
import caches are unchanged. Live provider
continuation and large catalogs were not measured for this UI update.

The text-only conversion remains a single pass over source items and constructs
no tool-output strings, attachment placeholders or warning sets. It introduces
no RPCs, blocking filesystem work, request fanout or cache invalidation. The
existing full-read/start/inject sequence and request budget remain unchanged.
Browser checks use mixed text/tool/reasoning/image fixtures and verify silent
text-only presentation after reload; native fixture history retains its tools.

Portable Fork and Revert adds no startup or per-message requests. Its nonempty
transfer still uses one uncapped source read, one start and one injection. Finding
the user turn and converting preceding history are linear; only the selected user
item is normalized for draft restoration, avoiding conversion of its tool output.
Draft persistence adds one ordinary destination draft write before publication;
there is no new cache or invalidation path. The first-turn case omits injection.
The browser regression report records a single creation and zero generation calls
until explicit submission, including double confirmation. Full-history service tests
verify read/start/inject counts and exclusive cutoffs. Remote provider latency and
large-history browser rendering are not measured by these mocked checks.
