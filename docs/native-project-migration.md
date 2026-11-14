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

## Native pin operations

Pins use `thread/section/move` with the built-in Pinned section ID
`01984de2-8f74-7c91-a3b2-5c5e937cf318`; unpin sends `sectionId: null`.
The old PUT contract is removed. New pins use `beforeThreadId` for top insertion.
Acknowledged moves update the UI without a duplicate list request; section
notifications and reconnect refresh native membership. Pinning replaces a
thread's section, consistent with native single-section semantics.

Pin reads paginate serially at 100 rows per request, with no separate writable
pin store or background polling. Legacy moves belong only to the old migration
revision described below; the current reader rejects unmigrated pins.

## Reproducible migration source and environment

The exact migration source is Git commit
`3f659043adef2fb075919dec669e88e843fe4889` (not the current package tag).
To obtain it without changing the working branch, extract it into a fresh source
folder and install that revision's locked dependencies:

```sh
migration_source=$(mktemp -d /tmp/codex-webui-migration.XXXXXX)
git archive 3f659043adef2fb075919dec669e88e843fe4889 | tar -x -C "$migration_source"
cd "$migration_source"
pnpm install --frozen-lockfile
# Stop the current WebUI before pointing this process at the same local state.
CODEX_HOME="$existing_webui_state_home" \
CODEXUI_CONNECTION_PROFILE="$existing_profile_id" \
CODEXUI_APP_SERVER_URL="$existing_exact_endpoint" \
pnpm run dev --host 127.0.0.1 --port 4173
```

Supply the **existing** values from the deployment being upgraded, not a new
profile or fresh home. Default profile is `legacy`; changing it creates a distinct
state namespace and does not migrate the old one. `CODEX_HOME` here is the
WebUI's local application-state home. The independently managed server must keep
its original user, remote Codex home, native database and capabilities; do not
point it at a different home or copy credentials. Keep the exact resolved endpoint
(including transport/address) used during migration and upgrade.

The Project receipt key is SHA-256 of
`JSON.stringify([profileId, resolvedAppServerUrl, initializedRemoteCodexHome])`.
The state file is `$CODEX_HOME/.codex-global-state.json` for `legacy`, or
`$CODEX_HOME/codexapp-profiles/<sha256(profileId)>/.codex-global-state.json` for a
named profile. An initialized remote home is required for the same receipt key;
a successful connection to a different server is not proof of migration.

Observable completion checks in the old revision:

- Authenticated `GET /codex-api/workspace-roots-state` succeeds in native mode;
  the receipt for the exact identity above has `completed: true`. Check native
  empty projects, duplicate identities, ordering and archived/imported membership.
- Separately, authenticated `GET /codex-api/thread-pins` succeeds and contains
  every intended old pin in native section order. `pinned-thread-ids` must be
  absent after the old migrator finishes. A completed Project receipt is **not**
  a pin receipt. Retry the old pin reader after an interrupted native move.
- Reload/reconnect and repeat both reads before replacing the old WebUI.

The current pin reader independently rejects any remaining valid legacy pin ID,
even with completed Projects or no legacy Projects. It never deletes the key or
moves sections. A pin error blocks pin loading/toggling in the sidebar, leaves
already loaded pins intact and displays a warning. Project upgrade errors block
Project loading/registration/rename/move/delete. Neither guard gates ordinary
native thread list/read, direct conversation navigation, or history APIs. They
can coexist: finish each prerequisite independently. Empty legacy pin arrays do
not represent unmigrated pins.
