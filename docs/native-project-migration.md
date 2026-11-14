# Native Projects and upgrade prerequisites

Native Project IDs, names, roots, positions and explicit `Thread.projectId`
associations are authoritative. Empty projects, identical names/roots and native
ordering are retained. Unassigned history remains visible. Cwd is an execution
path, never a membership rule. Native rename/delete/move operations do not delete
conversation contents or workspace files.

## Before upgrading from legacy Projects or pins

1. Back up the profile-scoped global state and the remote Codex home using your
   normal backup procedure. Do not delete legacy metadata, uploads, receipts or
   native databases. Keep the same connection profile, endpoint and remote home.
2. Run the pre-cleanup WebUI revision `3f659043adef2fb075919dec669e88e843fe4889`
   against a capable server (see below). Load Projects and pins. That revision
   migrates legacy roots, labels, order and archived/active membership and moves
   `pinned-thread-ids` into the built-in native Pinned section.
3. Resolve every migration error before upgrading. Ambiguous native identities or
   conflicting thread associations require explicit reconciliation in the old
   release. Interrupted migrations must finish there; do not manufacture a
   completion flag. Verify empty projects, duplicate names/roots, order, archived
   members, imported destinations and pins after reload/reconnect.
4. Confirm the existing connection's journal under
   `codexapp-native-project-migrations-v1` has `completed: true`. The old pin
   migration removes `pinned-thread-ids` only after successful moves; verify native
   pins before proceeding. Upgrade using the same connection identity.

The new runtime does not migrate or write legacy state. If registered legacy
roots/remote projects or an interrupted journal exist without that connection's
completed receipt, Project loading fails with a pre-upgrade instruction rather
than hiding data or inferring membership. Restore the old release to finish
migration. Completed receipts remain intact; stale legacy names cannot overwrite
native changes. New installations need no migration receipt.

## Supported server contract

The minimum supported deployment baseline is **Codex 0.169.0 with the required
experimental capabilities enabled**. Repository evidence in the previous version
verified disposable native Projects and native fork association on 0.169.0.
This is a support floor, not a claim that 0.169.0 introduced every API, nor that
all distributions with that version expose them. The generated 0.167.2 types and
pinned development dependency alone do not establish runtime compatibility.

Required APIs include `project/list/read/create/update/delete/move`, persistent
`Thread.projectId`, project-aware start/fork and `thread/metadata/update`;
`thread/list` with native section filtering/position ordering and
`thread/section/move`; metadata-only `thread/read`; and `thread/turns/list` with
`itemsView: notLoaded/full`, ascending/descending ordering and opaque cursors.
Browser workspace operations require the native `fs/*` APIs; composer search
requires `fuzzyFileSearch`. Fast mode additionally requires the selected
provider/model's `model/list.serviceTiers` to advertise `fast`, and
`turn/start.serviceTierForTurn` (`fast` or `default`). Missing tier metadata means
unknown availability; the model name provides no evidence.

Missing required APIs produce upgrade errors. Permission, transport and malformed
response errors remain distinct. Full-history fallback and legacy Project runtime
support have ended. Supported history pagination, absolute turn indices, fork
cutoffs, invalidation and concurrent-read protections are unchanged.

Portable Fork receipts, imported transcripts, incomplete-transfer safeguards and
per-response generation metadata remain in their existing services. No migration
or cleanup here deletes or rewrites that data. Native listing's pre-existing
injected-only import discovery limitation remains documented in
[the maintenance evidence](maintenance-cleanup.md#portable-discoverability-acceptance-comparison).
