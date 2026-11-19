# Connection profiles and retained uploads

Use `--connection-profile workstation-b` or `CODEXUI_CONNECTION_PROFILE=workstation-b` to identify the **remote machine**, independently of its WebSocket URL. IDs contain 1–80 letters, digits, dots, underscores or hyphens, starting with a letter or digit. Stop the backend and restart with the desired profile when changing the tunnel target; do not repoint a live connection to another machine. A local forwarding URL is not a durable machine identity.

The default profile is `legacy`. It stores backend model preferences and Portable
Fork records directly under the WebUI backend's `CODEX_HOME`. Named profiles
store them under `CODEX_HOME/codexapp-profiles/<sha256-profile-id>/`. Both use
atomic replacement and interprocess file locking. WebUI password sessions and
browser appearance are shared across profiles. Codex authentication belongs to
the App Server host. Browser model/mode choices and drafts are profile-scoped.
When the notification ready frame identifies a different profile, the UI reloads
once to discard remote caches and outstanding callbacks. A `connection-profile`
URL query hint prevents reload loops when browser storage is disabled. Returning
to a profile restores its own saved drafts.

Project identity, names, roots, positions and thread associations now belong to
the connected App Server's native Projects registry. Old local snapshots and
receipts stay in place. Use distinct connection profiles when retargeting independent hosts;
endpoint/home strings are not server instance UUIDs. See
[native Project and pin capabilities](native-project-migration.md).


## Upload inventory and capacity

Attachments are written on B under `<CODEXUI_REMOTE_UPLOAD_DIR or remote codexHome>/codexapp-uploads`. The 20 MiB per-file limit remains unchanged. Automatic deletion is disabled and retention is indefinite, including interrupted writes and uncertain submissions.

The backend keeps attempted uploads in `codexapp-upload-inventory.json` and
appends an intent to `codexapp-uploads.jsonl` before writing remotely. The journal
recovers tracked byte reservations if the inventory is missing. Recovered
attempts retain the journal's `unknown` outcome and older entries retain their
paths even when their size is unknown. Inventory bytes cover attempts tracked by
this backend that have recorded sizes.

`CODEXUI_UPLOAD_CAPACITY_BYTES` defaults to `1073741824` (1 GiB). Before a write, the backend atomically reserves its bytes in a shared inventory under A's state directory. This limit covers all profiles sharing that state directory, so shared upload roots cannot evade capacity by switching profiles. Raising the limit is an explicit operator action; zero prevents nonempty uploads. Ambiguous writes remain reserved. Unknown legacy sizes mean this is a tracked-byte budget, not a hard remote filesystem quota. Use a quota on B for a true filesystem limit.

The inventory and append-only intent journal remain shared across profiles intentionally. A profile-local history scan cannot prove another profile's attachments unreferenced. A successful write only proves staging; it does not prove whether a later submission referenced the path. Active uploads, unknown outcomes, staged uploads, and legacy entries are all protected.

## Conservative cleanup

Automatic cleanup requires complete knowledge of references across profiles and
clients. WebUI retains staged attachments and uncertain writes for operator review.

For operator-assisted cleanup, use disposable data first. Stop uploads and submissions on every client sharing the root; inventory the actual directory directly on B; preserve backups; inspect all relevant histories and drafts across clients and profiles; and classify uncertain references as protected. Verify that each candidate is an application-generated file directly inside the intended managed directory, resolve filesystem identity on B, reject symlinks and out-of-root targets, and recheck identity immediately before any operator deletion. Neither age, a failed write, nor absence from a partial history listing establishes eligibility. If complete reference information is unavailable, retain the file. Keep the local inventory unchanged unless independently audited: automatically releasing byte reservations after external deletion would falsely trust unverified cleanup. A fresh state directory loses historical accounting and must not be used to infer cleanup safety.

## Performance scope

Profile lookup hashes one short identifier. Successful uploads use two local
locked inventory updates and one journal append. Capacity checks scan tracked
attempts locally. Recovery reads the journal only when the inventory has no
records array. The accounting path issues no upstream directory or history
scans.
