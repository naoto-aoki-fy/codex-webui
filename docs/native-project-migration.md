# Native Project ownership and legacy migration

Native Project IDs, names, roots, positions and thread associations are the writable
source of truth. `NativeProjects` adapts native records to the existing workspace
HTTP surface; it does not maintain a second writable project registry. Folder
selection passes a native ID to `thread/start`; cwd remains an execution path.
Sidebar membership uses `Thread.projectId`, including when roots/names collide or
cwd moves. Empty native projects remain visible. Unassigned history stays visible
in an explicit Unassigned group, without guessing membership from its cwd.

## Migration and retries

The first native read captures the legacy roots, labels, project ordering and
archived/unarchived membership. The old grouping rules are used only to capture
this one-time input or to display an explicitly unsupported server's read-only
legacy state. Legacy fields and conversation-transfer receipts are not rewritten.

A durable journal under `codexapp-native-project-migrations-v1` in the existing
profile-scoped global state stores the frozen input and completion flag, scoped by
connection profile, endpoint and initialized remote Codex home. It is a migration
receipt, not an editable project registry. Each imported project has a stable
SHA-256 idempotency key and native migration metadata. A lost import response or
restart finds the same native project rather than creating another one.

Migration adopts a unique exact native name/root match. Multiple matches or an
existing conflicting native thread association stop migration with an explicit
error before overwriting associations. Resolve that specific identity conflict
before retrying. The journal preserves its original input after partial success.
Every acknowledged destination ID is checkpointed before validating its shape.
Every destination is read back, associations are assigned only after checking the
current native summary with
`thread/metadata/update`, and ordering is read back after `project/move`. Completion
is recorded only after these checks succeed. Unrelated native projects retain
relative order. After completion, legacy changes cannot recreate deleted projects
or overwrite native edits. The source snapshot remains intact for diagnosis.

Project reads and mutations are coalesced/serialized per service. Migration lists
archived and active thread summaries once and reads native summaries of existing
injected-only imports omitted by native lists, never histories or rollout contents;
pagination rejects repeated cursors, malformed envelopes and more than 100,000
rows. Association verification is serial, with at most one metadata read/update
per member. Subsequent completed reads perform only native project pagination.
No blocking filesystem work or per-message request fanout is introduced.

## Capability and compatibility rules

The build-time protocol remains pinned to 0.167.2; no dependency upgrade is needed.
Runtime support is verified by actual responses, not the bundled method catalog.
Only explicit JSON-RPC -32601 for `project/list` before migration activates
`legacy-readonly`. Creating, deleting or editing legacy roots is disabled there.
A transport error, denied call, malformed response, missing association capability
or failure after migration begins never switches writes back to legacy storage.

Migration needs project list/read/import/move and persistent thread project IDs;
unassigned members additionally require thread/metadata/update. New project
creation, rename and deletion require their respective native operations. All
errors reach the browser with the failing method/server message; history may still
be opened independently. The current 0.169.0 server has been checked with
exclusively disposable projects/threads for create idempotency, updates, import,
association, ordering, deletion and native fork project retention.

Portable conversation-transfer receipts and imported transcripts remain owned by
`ConversationTransferService`. New transfers pass the source's native project ID
to native thread creation. Previously imported content stays in its original
receipt and is still decorated onto native history; it is not migrated or erased.

Native `thread/list` on the checked 0.169.0 server omits injected-only Portable
conversations even after naming them, with all providers, database-only listing,
and native title search. Existing imported content is still displayed from its
receipt when opened by destination ID, and migration preserves that destination's
native project association. This upstream discovery limitation does not authorize
fabricating native turns, editing rollouts or restoring a custom merged index.
Native discovery may require a subsequent ordinary user turn; that transition
was not exercised here. Keep destination links for injected-only conversations.
