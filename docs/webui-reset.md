# Reset Codex WebUI

Run the reset from a source checkout with Node.js 18.3 or newer. The script uses
Node's built-ins and runs before any WebUI build or dependency install.
Destructive execution requires Linux with a visible `/proc`. Use the same
OS account, `CODEX_HOME`, and temporary-directory environment as the WebUI
backend. The script prints the hostname, resolved roots, and planned actions.
Its default is a dry run.

## Reset the backend

```sh
pnpm reset:webui --profile workstation-b --dry-run
pnpm reset:webui --profile workstation-b --execute --offline

pnpm reset:webui --all-profiles --shared --dry-run
pnpm reset:webui --all-profiles --shared --execute --offline

pnpm reset:webui --all-profiles --shared --build --dry-run
```

Without pnpm, substitute `node scripts/reset-webui.mjs`. With no profile
argument, the command uses `CODEXUI_CONNECTION_PROFILE` or `legacy`. The
backend home is `CODEX_HOME` or `~/.codex`. Set an absolute `CODEX_HOME`
when the backend was launched with another home. Add `--shared` to clear
global WebUI state for every profile that uses that same home. Add `--build`
to include the checkout's generated outputs. Use the same flags from the
reviewed dry run when executing.

Close WebUI tabs and stop every WebUI backend, build, or other writer that can
access the selected locations, including older deployments, containers and
other machines mounting those files. Stop Codex Desktop or any other writer
of a selected mixed global-state file. For a separate App Server host, a
backend-only reset leaves that host alone. `--offline` confirms that the
operator has stopped the relevant writers. On Linux, current CLI and Vite
backends and build commands use a per-user maintenance lease. The reset also
checks visible processes for recognizable older entry points. The local
lease cannot account for cross-host writers or other PID namespaces.

The reset refuses symbolic links in selected paths, hard-linked files, special
files, mounted cleanup targets, and active-looking persistence locks. It
preflights the plan, rechecks observed files before execution, and stops at the
first detected change or filesystem error. A reset can be partial if an
operation fails after earlier changes. The command prints each applied action,
and a new dry run shows what remains. A reset interrupted before releasing
`/tmp/codex-webui-maintenance-<uid>/reset` can leave that lock directory behind.
If it exists, verify that no reset is running under the account, then remove
just the empty `reset` directory with `rmdir` and retry.

Export or back up WebUI data you still need. An explicit reset discards selected
local drafts and recovery records and can remove Portable Fork retry and
presentation records. Reconcile any pending sends or transfers before starting.
The native conversations and any messages already accepted by the App Server
remain there. Back up upload accounting before `--shared` if you need it for
a later audit. Existing remote attachments still occupy disk after local
accounting is reset. If you use `--build --execute`, rebuild before starting
the packaged CLI. The Vite development server can start from source.

## Backend inventory

| Scope | Cleanup |
| --- | --- |
| Selected profile | `codexapp-thread-index.json` (active attachment-intent recovery with older list snapshots tolerated) and `codexapp-model-preferences.json` (active defaults, reasoning, acceptance records and usage). For `legacy` these are under the backend home. Named profiles use `codexapp-profiles/<SHA-256 of profile ID>/`. |
| Profile global JSON | Remove `conversation-transfers-v1` (active Portable Fork records) and `codexapp-native-project-migrations-v1` (legacy, read by the upgrade guard) when receipts are complete and no legacy Project inputs require them. The root `.codex-global-state.json` stays in place, and retained top-level members keep their original JSON bytes. A named profile's copy is deleted only when every member is safely removable. Empty WebUI profile directories are then removed. |
| Profile scratch | Exact UUID-suffixed temporary files for the thread index and model preferences, state-writer temporaries within named profiles, and temporary files left by this reset. Exact WebUI lock directories are eligible after at least 30 seconds, when empty and all writers are stopped. |
| Shared backend home, with `--shared` | `codexapp-upload-inventory.json`, `codexapp-uploads.jsonl`, and `webui-auth-sessions.json` plus their recognized scratch paths. The upload journal began as legacy import input and is still appended for new upload attempts. Session deletion revokes all WebUI password-login tokens for this home on restart. |
| OS temporary directory, with `--shared` | Flat files matching the inline-media writer's `inline-image-`, `inline-file-`, and `generated-image-` names with a SHA-1 suffix in `codex-web-inline-media/`. Unrecognized entries stay. |
| Checkout, with `--build` | `dist/`, `dist-cli/`, `output/playwright/`, `test-results/`, and root-level `*.tsbuildinfo`. Cleanup checks the Git index and refuses tracked data or nested Git worktrees. The rest of `output/`, dependencies, source, and workspace data stay. |

Official Codex credentials, `config.toml`, native histories and rollout files,
native project and thread databases, installed skills, user instructions,
MCP configuration, repositories, and worktrees are outside the deletion plan.
Native Legacy state keys such as `electron-saved-workspace-roots`,
`electron-workspace-root-labels`, `active-workspace-roots`, `project-order`, and
`pinned-thread-ids` are preserved, as are `remote-projects`, incomplete or
required migration receipts, and other unrecognized global keys. Complete any
required migration using the [native Project migration guide](native-project-migration.md).
Mixed root global-state locks and writer scratch files of ambiguous ownership
are preserved. If a mixed file would otherwise change while a lock exists,
the reset stops. Malformed or ambiguous global JSON stops execution before
state changes. Historical `codexapp-turn-metadata/` sidecars have no current
writer and may contain unique evidence, so the reset excludes them.

## Clean up files on the App Server host

Run this separately **on the App Server host** as the account that owns the
files, with all connected WebUI backends (including those on other hosts)
stopped. Stop the App Server and other local writers of the selected paths
before executing. Specify the initialized Codex home's real absolute path
on that host. The WebSocket address and SSH forwarding address do not
identify a filesystem. The confirmation value is the exact hostname printed
by the dry run.

```sh
node scripts/reset-webui.mjs --remote --remote-codex-home /srv/codex --dry-run

node scripts/reset-webui.mjs --remote --remote-codex-home /srv/codex \
  --execute --offline --confirm-remote app-server-host
```

Remote mode removes WebUI cache records from `cache/model-history/v1/` when
their names and payloads match the current rollout metadata writer. The
directory is removed if it becomes empty. The parent cache tree, rollouts,
and unrecognized cache files are preserved. The cache can regenerate on
subsequent reads.

Attachments are retained by default. Only select an exact upload filename
after you have independently established WebUI ownership and reviewed all
relevant references and submissions. A deletion can break links in native
conversations, and the reset cannot establish reference safety from file age,
upload status, or a partial history scan. If in doubt, keep the file.
For a custom upload location, pass the value used for
`CODEXUI_REMOTE_UPLOAD_DIR` as `--remote-upload-root`. The script appends
`codexapp-uploads` to the given root, or to the remote Codex home by default.

```sh
node scripts/reset-webui.mjs --remote --remote-codex-home /srv/codex \
  --remote-upload-root /srv/staging \
  --remote-upload 1b937cf7-0751-4c14-972a-cedc95270924-report.pdf \
  --execute --offline --confirm-remote app-server-host
```

Repeat `--remote-upload` to name additional individually reviewed files.
The upload directory and all other attachments stay. Remote mode leaves
backend upload accounting unchanged.

## Clear browser state

Repeat for each browser profile and each exact WebUI origin (scheme, host,
and port). Close other WebUI tabs and resume from a passive page on that
same origin, such as `/sw.js` when served directly, or the WebUI password
prompt without signing in. Use the browser developer tools' storage panels
to delete the following entries individually. Clearing all site data could
remove other applications' data on a shared origin.

| Storage | WebUI entries |
| --- | --- |
| Local Storage | Keys beginning `codex-web-local.` and keys in the `codex-profile.<profile ID>.codex-web-local.` namespaces. These contain shared appearance and layout, sidebar expansion/sort, the connection-profile hint, model/mode context preferences, drafts and archived drafts, legacy queue receipts, and retired WebUI migration keys. |
| Session Storage | The same namespaces for `tab-id.v1` and thread-draft resume pointers. Closing all existing WebUI tabs releases their session storage. Remove entries in any tab you keep open. |
| IndexedDB | Delete `codex-web-local.persistence.v1`, whose `records` store holds profile-scoped queue recovery receipts. If deletion is blocked, close other WebUI tabs and retry. |
| Cookies | Remove the WebUI `portal_session` cookie for the exact host, path `/`, if you can identify it as the WebUI cookie. If ownership is ambiguous, leave it. Resetting `webui-auth-sessions.json` invalidates previously issued WebUI tokens regardless. |
| Cache Storage and service workers | Old installations may have caches beginning `codexweb-shell-` or `codexweb-assets-`. The current `/sw.js` retires the old WebUI worker and removes those named caches. To clear them manually, delete only those owned caches and unregister only the verified WebUI worker. |

Open the unsuffixed WebUI URL in a fresh tab afterward. This avoids reusing a
`connection-profile` hint or a thread route from an old URL. For a profile-only
browser reset, remove only that profile's entries and the corresponding
`queue-submissions.v1` key in the IndexedDB `records` store. Shared and legacy
keys both lack a profile prefix, so use the
[storage ownership table](browser-persistence.md#current-key-disposition-and-runtime-owners)
for a legacy-only reset.
