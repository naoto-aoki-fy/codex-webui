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

The default root for new uploads is `~/.local/share/codex-webui/uploads` on
Linux and macOS or `%USERPROFILE%\.local\share\codex-webui\uploads` on Windows.
These paths use the home directory of the OS account running the connected
App Server. An unset, empty, or whitespace-only `CODEXUI_REMOTE_UPLOAD_DIR`
uses this default. The WebUI uses one App Server `process/spawn` lookup per
connection when an upload first needs the account's home. Custom `CODEX_HOME`
locations are supported.

To override the default, set `CODEXUI_REMOTE_UPLOAD_DIR` in the WebUI backend
environment to a dedicated absolute path on the App Server host. The App Server
must be able to create and write to that directory. Uploaded bytes are stored
under `codexapp-uploads/<sha256(ID)>/` within the selected root via App Server RPC.
The backend resolves the App Server's Codex home and verifies both paths via
remote metadata before creating missing directories or writing files. If the
OS home lookup is unavailable or the default root cannot be verified, set the
override to an absolute path outside Codex home. Use paths with no symbolic
links and keep them stable during uploads. The protocol does not expose
directory identity or atomic path-checked writes, so avoid bind mounts, mapped
drives, or share aliases that expose Codex home through another path.

Attachments in the former `.codex-webui-uploads` directory and their accounting
records are retained. Existing history and drafts continue to use the saved
absolute attachment paths.

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
