# Connection profiles and retained uploads

Use `--connection-profile workstation-b` or `CODEXUI_CONNECTION_PROFILE=workstation-b` to identify the **remote machine**, independently of its WebSocket URL. IDs contain 1–80 letters, digits, dots, underscores or hyphens, starting with a letter or digit. Stop the backend and restart with the desired profile when changing the tunnel target; do not repoint a live connection to another machine. A local forwarding URL is not a durable machine identity.

The default profile is `legacy`. Existing workspace roots, labels, active roots, project ordering, pinned-thread migration state and application thread-index files remain in their original local state directory and belong only to this profile. Named profiles start empty under `CODEX_HOME/codexapp-profiles/<sha256-profile-id>/`. This migration is repeatable and performs no copying, renaming or deletion. Existing atomic replacement and interprocess file locking apply to named profile stores. Authentication session state stays global in A's local state directory; Codex authentication belongs to B. Global browser appearance and reasoning preferences remain shared. Remote browser context, selected threads, token usage, per-thread model/mode choices and composer drafts use profile-specific storage keys; legacy keys stay assigned only to `legacy`. On detecting a different profile in the notification ready frame, the UI reloads once to discard all remote caches and outstanding callbacks. A `connection-profile` URL query hint prevents reload loops when browser storage is disabled. Returning to a profile restores its saved drafts; drafts are never copied to another profile.

Project identity, names, roots, positions and thread associations now belong to
the connected App Server's native Projects registry. Local profile state retains
legacy snapshots and the scoped migration receipt, not a parallel writable
registry. Use distinct connection profiles when retargeting independent hosts;
endpoint/home strings are not server instance UUIDs. See
[native Project migration and compatibility](native-project-migration.md).


## Upload inventory and capacity

Attachments are written on B under `<CODEXUI_REMOTE_UPLOAD_DIR or remote codexHome>/codexapp-uploads`. The 20 MiB per-file limit remains unchanged. Automatic deletion is disabled and retention is indefinite, including interrupted writes and uncertain submissions.

An authenticated `GET /codex-api/uploads` returns an inspectable inventory, byte accounting, unknown-size count, retention information, and cleanup preview. Accounting covers **tracked attempted uploads only**, not all files in the remote directory. It imports the legacy local `codexapp-uploads.jsonl` journal once; legacy entries with unknown size remain visible. Files predating the journal, manually copied files, and uploads tracked in another A state directory are outside this accounting.

`CODEXUI_UPLOAD_CAPACITY_BYTES` defaults to `1073741824` (1 GiB). Before a write, the backend atomically reserves its bytes in a shared inventory under A's state directory. This limit covers all profiles sharing that state directory, so shared upload roots cannot evade capacity by switching profiles. At 80% usage the inventory reports `capacityWarning`. Raising the limit is an explicit operator action; zero prevents nonempty uploads. Ambiguous writes remain reserved. Unknown legacy sizes mean this is a tracked-byte budget, not a hard remote filesystem quota. Use a quota on B for a true filesystem limit.

The inventory and append-only intent journal remain shared across profiles intentionally. A profile-local history scan cannot prove another profile's attachments unreferenced. A successful write only proves staging; it does not prove whether a later submission referenced the path. Active uploads, unknown outcomes, staged uploads, and legacy entries are all protected.

## Conservative cleanup

The preview currently reports an empty `eligiblePaths` set and `supported: false`. Although the bundled protocol describes `fs/remove`, there is no complete cross-profile, cross-client reference oracle or transaction joining history inspection and remote deletion. The client therefore cannot safely authorize automated cleanup, and exposes no deletion endpoint. No remote deletion is performed by inventory inspection or capacity checks.

For operator-assisted cleanup, use disposable data first. Stop uploads and submissions on every client sharing the root; inventory the actual directory directly on B; preserve backups; inspect all relevant histories and drafts across clients and profiles; and classify uncertain references as protected. Verify that each candidate is an application-generated file directly inside the intended managed directory, resolve filesystem identity on B, reject symlinks and out-of-root targets, and recheck identity immediately before any operator deletion. Neither age, a failed write, nor absence from a partial history listing establishes eligibility. If complete reference information is unavailable, retain the file. Keep the local inventory unchanged unless independently audited: automatically releasing byte reservations after external deletion would falsely trust unverified cleanup. A fresh state directory loses historical accounting and must not be used to infer cleanup safety.

## Performance scope

Workspace reads remain one local JSON read; updates retain the existing per-file queue, interprocess lock and atomic rename. Profile lookup hashes one short identifier; it creates no upstream requests. Upload accounting adds two local locked inventory updates per successful upload and one legacy journal append, with no upstream directory scan or history fanout. Inventory is O(number of tracked attempts) in time and payload and should be inspected before sustained high-volume upload usage; filesystem quota remains the scalable capacity authority. This is concrete code-path analysis, not a live WAN benchmark.
