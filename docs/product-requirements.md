# Protected product requirements

This is the authoritative definition of Codex WebUI's protected product
capabilities. These are permanent product requirements, independent of maintenance
scope or cleanup item numbers. Technical documents remain authoritative for current
implementation details; this document defines the behavior those implementations
must preserve. A requirement is not proof of live acceptance on every server version.

Routine maintenance, refactoring, upstream API migration, UI simplification and
dead-code cleanup do not authorize removal or functional reduction of these
capabilities. Replacements must preserve their user-facing behavior and persistence
guarantees. Removal or reduction requires an explicit, deliberately approved product
requirement change. Protection applies to behavior, not particular internal
functions, APIs, storage layouts, limits, file names or implementation strategies.

## CAP-001: Fork and Revert

**Status: Protected — Core Product Requirement**

### Rationale

Conventional Edit Message can leave users uncertain about what happens to an
existing conversation. Fork and Revert is an intentional alternative: preserve the
original conversation and create a separate branch in which an earlier prompt can
be revised. This is a product decision, not an incidental implementation detail.

### Required behavior

- Users can initiate Fork and Revert from an eligible historical user message.
- The original conversation remains intact. A separate destination retains the
  history preceding the selected user message.
- The selected prompt is restored to the destination composer as an editable draft.
  No response is generated until the user explicitly submits the revised message.
- The destination can be revisited after navigation and reload; the restored draft
  persists as an ordinary composer draft.
- The UI must clearly distinguish in-place Revert from Fork and Revert.

Forking from an assistant response retains history **through that response,
inclusive**. Fork and Revert retains history **before the selected user message**
and restores that message for editing. These operations are not interchangeable.
In-place Revert truncates the existing conversation instead of preserving it in a
separate branch. Neither operation restores workspace file bytes.

Fork and Revert must not be replaced by conventional Edit Message merely to
simplify the UI or consolidate code. An alternative implementation must retain
non-destructive branching, draft restoration and explicit resubmission.

### Current behavior and limitations

The primary user-message button visibly says **Revert**, but its tooltip and
accessibility name say **Fork and Revert**, and it performs Fork and Revert.
The adjacent menu explicitly offers both actions. This labeling inconsistency is
not a requirement to preserve; correcting it is a separate UI change. Tests must
currently distinguish the main button from the menu's in-place Revert option.

Eligibility and native cutoff validation depend on a persisted turn boundary and
an inactive source turn. Destination execution metadata may be unavailable; see
CAP-003. A failed stage can leave a retained fork; inspect the reported destination
instead of automatically repeating a mutation.

### Regression criteria and references

Minimum: original survives; destination has exactly the preceding history; selected
prompt is restored; no automatic submission; destination and draft survive reload.

- [Draft restoration acceptance](../tests/git-worktrees-rollback/rollback-appends-rolled-back-user-text-into-composer-input.md)
- [Action distinction acceptance](../tests/git-worktrees-rollback/user-message-edit-action-replaces-rollback-button.md)
- [Desktop orchestration and failure-stage tests](../src/composables/useDesktopState.test.ts)
- Technical paths: [desktop state](../src/composables/useDesktopState.ts),
  [route/draft handling](../src/App.vue),
  [conversation controls](../src/components/content/ThreadConversation.vue), and
  [fork implementation details](cross-provider-forks.md).

## CAP-002: Portable Fork

**Status: Protected — Core Product Requirement**

### Rationale

Portable Fork enables continuation of an existing conversation with a different
model provider. Native Fork preserves the source provider and server-managed
conversation state, so it is not an equivalent cross-provider continuation path.
Portable Fork is intentional product functionality even when Native Fork exists.

### Required behavior

- Users explicitly select a destination provider and can transfer either the whole
  conversation or its history through a selected response, inclusive.
- Eligible historical content beyond the currently loaded UI window is included.
  Original roles, ordering and readable text are preserved.
- The destination can continue using transferred context. Imported history remains
  available after navigation, reload and reopening.
- The source conversation and existing composer draft remain unchanged.
- Cancellation creates no unintended destination and triggers no generation.
- Duplicate requests do not repeat imports. Failed or ambiguous operations are not
  automatically replayed where that risks duplicate conversation content.

Portable Fork must not be removed because Native Fork exists, upstream APIs change,
or transfer requires application-owned logic. RPC methods, persistence architecture
and transfer limits may evolve while preserving cross-provider continuation.

### Transfer scope and limitations

The current transfer includes ordinary user and assistant text, preserving readable
formatting. It excludes tool calls/results, reasoning traces, images, attachments,
instructions and complete provider execution state. It is not complete
execution-state migration. Empty text-only histories and oversized transfers fail
rather than silently truncating; supported providers and injection depend on the
connected server. The current dialog selects a provider and resolves its default
model; users can choose another model in that provider afterward.

An injected-only destination may not appear in native thread lists/search until
it has an ordinary turn. This is a known upstream discoverability limitation, not
permission to remove persisted imported history or fabricate a turn. Reopening by
known destination URL and sidebar discoverability are separate acceptance checks;
see [runtime policy](native-project-migration.md) and
[discoverability evidence](maintenance-cleanup.md#portable-discoverability-acceptance-comparison).
A lost creation acknowledgment may leave a destination with an unknown ID. Inspect
the native list and reported stage before a deliberate new operation; never replay
an uncertain injection automatically.

### Regression criteria and references

Minimum: transfer to another provider includes older unloaded history; reload
preserves imports; an explicit continuation uses that context; cancellation,
duplicate requests and uncertain failures do not create repeated operations.

- [Manual native/portable cutoff, persistence and failure checks](../tests/thread-loading-state/response-fork-cutoff.md)
- [Transfer service tests](../src/server/conversationTransfer.test.ts)
- [Desktop orchestration tests](../src/composables/useDesktopState.test.ts)
- Technical authority: [conversation transfer](cross-provider-forks.md).
  Mocked tests establish protocol behavior, not live provider compatibility.

## CAP-003: Historical Response Metadata

**Status: Protected — Core Product Requirement**

### Rationale

Historical timestamps, models and reasoning efforts let users review conversations,
compare responses and understand differences in model behavior. They describe past
execution independently of the currently selected composer settings.

### Required behavior

- Users can inspect historical response timestamps and, when reliable evidence is
  available, the model and reasoning effort used for each response.
- Metadata stays associated with the correct response and conversation across
  reload, navigation and history pagination. Unrelated responses or threads must
  never supply another response's metadata.
- Changing current model/effort settings must not change historical metadata.
  Missing evidence stays unavailable; guessed values must never fill the gap.

Timestamps reflect actual message/response events, never inferred thread activity.
Where supported, distinguish user submission time from assistant completion time.
Streaming and intermediate messages must not inherit a final response's completion
timestamp. The current UI presents these as Sent and Answered in browser local time.

Historical model and effort require reliable execution evidence. The current
composer selection is never a fallback. Unknown, unspecified and explicitly
recorded effort values (including `none`) remain distinguishable.

Historical metadata must not be removed for UI simplification, history optimization
or metadata-storage consolidation. Caching and recovery can change while reliable
historical information remains visible and correctly attributed.

### Known limitations

Native Fork and Fork and Revert can produce histories without inherited execution
metadata. Missing destination evidence means historical model/effort is unknown;
source matching or current settings must not conceal the gap. Portable Fork's
imported transcript attribution is distinct from actual destination execution
metadata. Future improvements may preserve more metadata across forks while
retaining that distinction. Timestamps also remain absent where event evidence
is unavailable. See the technical authority for recovery and cache limitations.

### Regression criteria and references

Minimum: timestamps, models and efforts are correctly attributed through reload,
navigation and pagination; current settings never overwrite history; unavailable
metadata is not fabricated, and streaming timestamps are suppressed correctly.

- [Timestamp acceptance and active coverage](../tests/chat-composer-rendering/message-timestamps.md)
- [Model/effort acceptance](../tests/chat-composer-rendering/per-response-model-and-reasoning-effort.md)
- [Timestamp normalization tests](../src/api/normalizers/v2.test.ts) and
  [normal/earlier-page preservation tests](../src/server/threadLiveStateRetirement.test.ts)
- [Rollout recovery/cache tests](../src/server/rolloutGenerationMetadata.test.ts),
  [execution metadata integration tests](../src/server/turnGenerationMetadata.test.ts),
  and [metadata value/label tests](../src/turnGenerationMetadata.test.ts)
- Technical authority: [generation metadata](turn-generation-metadata.md);
  timestamp parsing/formatting: [messageTimestamps.ts](../src/messageTimestamps.ts).

## Maintaining regression protection

Before changing related behavior, review the corresponding CAP identifier, identify
affected user-facing and persistence guarantees, and update and execute the relevant
regressions. Keep these identifiers alongside unit/integration and manual acceptance
coverage. Record fixture results separately from live runtime results and historical
verification records. Documentation does not mechanically prevent removal: these
requirements, agent instructions and executable regression coverage work together.
