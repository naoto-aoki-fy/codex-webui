# Connection profiles and retained uploads

Use `--connection-profile workstation-b` or `CODEXUI_CONNECTION_PROFILE=workstation-b` to identify the **remote machine**, independently of its WebSocket URL. IDs contain 1–80 letters, digits, dots, underscores or hyphens, starting with a letter or digit. Stop the backend and restart with the desired profile when changing the tunnel target; do not repoint a live connection to another machine. A local forwarding URL is not a durable machine identity.

The default profile is `legacy`. Existing workspace roots, labels, active roots, project ordering, historical pin records and application thread-index files remain in their original local state directory and belong only to this profile. Named profiles start empty under `CODEX_HOME/codexapp-profiles/<sha256-profile-id>/`. Profile selection leaves existing local files in place. Existing atomic replacement and interprocess file locking apply to named profile stores. Authentication session state stays global in A's local state directory; Codex authentication belongs to B. Global browser appearance and reasoning preferences remain shared. Remote browser context, selected threads, token usage, per-thread model/mode choices and composer drafts use profile-specific storage keys; legacy keys stay assigned only to `legacy`. On detecting a different profile in the notification ready frame, the UI reloads once to discard all remote caches and outstanding callbacks. A `connection-profile` URL query hint prevents reload loops when browser storage is disabled. Returning to a profile restores its saved drafts; drafts are never copied to another profile.

Project identity, names, roots, positions and thread associations now belong to
the connected App Server's native Projects registry. Old local snapshots and
receipts stay in place. Use distinct connection profiles when retargeting independent hosts;
endpoint/home strings are not server instance UUIDs. See
[native Project and pin capabilities](native-project-migration.md).


## Upload inventory and capacity

Attachments are written on B under `<CODEXUI_REMOTE_UPLOAD_DIR or remote codexHome>/codexapp-uploads`. The 20 MiB per-file limit remains unchanged. Automatic deletion is disabled and retention is indefinite, including interrupted writes and uncertain submissions.

The backend keeps attempted uploads in `codexapp-upload-inventory.json` and
appends an intent to `codexapp-uploads.jsonl` before writing remotely. Inventory
bytes cover the attempts tracked by this backend. Manually copied files, files
tracked elsewhere and journal entries with unknown size are outside that total.

`CODEXUI_UPLOAD_CAPACITY_BYTES` defaults to `1073741824` (1 GiB). Before a write, the backend atomically reserves its bytes in a shared inventory under A's state directory. This limit covers all profiles sharing that state directory, so shared upload roots cannot evade capacity by switching profiles. Raising the limit is an explicit operator action; zero prevents nonempty uploads. Ambiguous writes remain reserved. Unknown legacy sizes mean this is a tracked-byte budget, not a hard remote filesystem quota. Use a quota on B for a true filesystem limit.

The inventory and append-only intent journal remain shared across profiles intentionally. A profile-local history scan cannot prove another profile's attachments unreferenced. A successful write only proves staging; it does not prove whether a later submission referenced the path. Active uploads, unknown outcomes, staged uploads, and legacy entries are all protected.

## Conservative cleanup

Automatic cleanup requires complete knowledge of references across profiles and
clients. WebUI retains staged attachments and uncertain writes for operator review.

For operator-assisted cleanup, use disposable data first. Stop uploads and submissions on every client sharing the root; inventory the actual directory directly on B; preserve backups; inspect all relevant histories and drafts across clients and profiles; and classify uncertain references as protected. Verify that each candidate is an application-generated file directly inside the intended managed directory, resolve filesystem identity on B, reject symlinks and out-of-root targets, and recheck identity immediately before any operator deletion. Neither age, a failed write, nor absence from a partial history listing establishes eligibility. If complete reference information is unavailable, retain the file. Keep the local inventory unchanged unless independently audited: automatically releasing byte reservations after external deletion would falsely trust unverified cleanup. A fresh state directory loses historical accounting and must not be used to infer cleanup safety.

## Performance scope

Workspace reads remain one local JSON read; updates retain the existing per-file queue, interprocess lock and atomic rename. Profile lookup hashes one short identifier; it creates no upstream requests. Upload accounting adds two local locked inventory updates per successful upload and one legacy journal append, with no upstream directory scan or history fanout. Capacity checks scan the tracked attempts locally before a write; filesystem quota remains the scalable capacity authority. This is concrete code-path analysis, not a live WAN benchmark.
