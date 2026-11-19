# Native Projects, pins and supported server capabilities

Native Project IDs, names, roots, positions and explicit `Thread.projectId`
associations are authoritative. Empty projects, identical names/roots and native
ordering are retained. Unassigned history remains visible. Cwd is an execution
path, never a membership rule. Native rename/delete/move operations do not delete
conversation contents or workspace files.

## Historical local records

The connected App Server supplies Projects and pin membership. WebUI leaves
earlier local roots, labels, pins and receipts untouched. Records that exist
only in those older formats do not appear as native Projects or pins. Existing
conversations remain available through native thread listing or by their ID.

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
response errors remain distinct.

Portable Fork receipts, imported transcripts, incomplete-transfer safeguards and
per-response generation metadata remain in their existing services. No migration
or cleanup here deletes or rewrites that data. Native listing's pre-existing
injected-only import discovery limitation remains documented in
[the maintenance evidence](maintenance-cleanup.md#portable-discoverability-acceptance-comparison).

## Native pin operations

Pins use `thread/section/move` with the built-in Pinned section ID
`01984de2-8f74-7c91-a3b2-5c5e937cf318`; unpin sends `sectionId: null`.
The old PUT contract is removed. New pins use `beforeThreadId` for top insertion.
Acknowledged moves update the UI without a duplicate list request; section
notifications and reconnect refresh native membership. Pinning replaces a
thread's section, consistent with native single-section semantics.

Pin reads paginate serially at 100 rows per request. Reads and writes use only
native section membership.

Project and pin reads make no local state-file reads. Registering a root walks
the native Project list once before reusing or creating a Project. Concurrent
Project reads still coalesce, and mutations use the existing frontend cache
invalidation. Live latency was not measured for the guard removal.
