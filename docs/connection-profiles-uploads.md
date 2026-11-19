# App Server IDs, storage, and uploads

Each WebUI backend process connects to one Codex App Server. The ID comes from
`--connection-profile workstation-b`, then `CODEXUI_CONNECTION_PROFILE=workstation-b`,
then the WebUI backend's short hostname (the part before the first dot, as in
`hostname -s`).
IDs are case-sensitive and contain 1–80 ASCII letters, digits, dots, underscores
or hyphens, starting with a letter or digit. The URL selects the endpoint
independently of the ID. Use a unique ID for each App Server, including when
multiple servers use the same SSH forwarding URL at different times. Stop and
restart the backend with the desired ID and URL when changing servers. Use the
same ID again to reuse that server's saved state.

## Storage on the WebUI backend

| Data | Windows | macOS | Linux defaults |
| --- | --- | --- | --- |
| Configuration | `%APPDATA%\codex-webui\` | `~/Library/Application Support/codex-webui/` | `~/.config/codex-webui/` |
| Persistent data | `%LOCALAPPDATA%\codex-webui\` | `~/Library/Application Support/codex-webui/` | `~/.local/share/codex-webui/` |
| Cache | `%LOCALAPPDATA%\codex-webui\Cache\` | `~/Library/Caches/codex-webui/` | `~/.cache/codex-webui/` |
| Logs | `%LOCALAPPDATA%\codex-webui\Logs\` | `~/Library/Logs/codex-webui/` | `~/.local/state/codex-webui/` |

Linux uses absolute values from `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
`XDG_CACHE_HOME`, and `XDG_STATE_HOME` when set. Directories are created
as needed. The backend currently writes logs to the console.

Persistent state lives in `app-servers/<sha256(ID)>/` under the data directory.
It includes model preferences and usage, Portable Fork records, and the upload
inventory and journal. Inline media and parsed rollout metadata use the same
namespace under the cache directory. `global/auth-sessions.json` stores WebUI
password sessions for the backend. The browser confirms the backend's ID
before loading its drafts, queue recovery records, and per-thread preferences.
Connection IDs in browser keys escape dots to keep namespaces unambiguous.
Browser appearance settings are shared.

Codex settings, credentials, sessions, history, and skills remain on the App
Server. Existing WebUI files under any Codex home are left untouched. The first
launch for each ID starts with empty WebUI state, including an explicitly chosen
ID of `legacy`.

## Uploads on the App Server

Set `CODEXUI_REMOTE_UPLOAD_DIR` in the WebUI backend environment to a dedicated
absolute path **on the App Server host**, outside its Codex home. The App Server
must be able to create and write to that directory. Uploaded bytes are stored in
`<CODEXUI_REMOTE_UPLOAD_DIR>/codexapp-uploads/<sha256(ID)>/` via App Server RPC.
The backend needs only the ledger and journal. It resolves Codex home from the
connected App Server and checks both paths via remote metadata before creating
directories or writing files. If the home or the paths cannot be verified,
uploads fail with a configuration error. Use absolute paths with no symbolic
links in either path. Place the dedicated storage outside Codex home on the
App Server, and keep paths stable during uploads. The protocol does not expose
directory identity or atomic path-checked writes, so avoid bind mounts, mapped
drives, or share aliases that expose Codex home through another path.

The limits are 20 MiB per file and 21 MiB per multipart request. The backend
reserves each attempt in `uploads/inventory.json` under the ID's data directory
and appends to `uploads/journal.jsonl` before sending a write. The journal
recovers reservations as `unknown` if the inventory is missing.
`CODEXUI_UPLOAD_CAPACITY_BYTES` defaults to 1073741824 (1 GiB) per ID and bounds
tracked attempts. A filesystem quota on the App Server can enforce an overall
physical limit. Unknown outcomes retain their reservations, including failed or
timed-out writes. Remote writes are never automatically retried, and retention
is indefinite.

## Conservative cleanup

For operator-assisted cleanup, stop uploads and submissions on every client
sharing the directory. Inspect the actual files on the App Server, keep backups,
and check relevant histories and drafts. Only consider an application-generated
file directly inside the intended ID directory after resolving filesystem
identity. Keep files with uncertain references, including files absent from
partial history or staging requests with an unknown outcome. Keep the backend
accounting until it has been independently audited.
See the [reset tool](webui-reset.md#app-server-uploads).
