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
state changes.

## Include historical WebUI state

`--include-legacy` evaluates every verified historical format in the scope
you select. It defaults to off. A named profile keeps its own state scope.
`--profile legacy` covers pre-profile state, `--all-profiles` also covers
historical sidecars keyed by server identity, and `--shared` includes the
backend's shared files and temporary directory. `--build` is independent.
The hostname and exact paths or JSON member names appear in the plan.

```sh
pnpm reset:webui --all-profiles --shared --include-legacy --dry-run
pnpm reset:webui --all-profiles --shared --include-legacy --execute --offline
```

Files that may hold unique historical information require
`--acknowledge-legacy-data-loss`. Without it, the plan explains why those
files or keys are kept and still includes verified disposable artifacts. Back
up the listed files if you need their contents. Include the acknowledgement
in your dry run to review the exact expanded plan before executing.

```sh
pnpm reset:webui --all-profiles --shared --include-legacy --acknowledge-legacy-data-loss --dry-run
pnpm reset:webui --all-profiles --shared --include-legacy --acknowledge-legacy-data-loss --execute --offline
```

The legacy option keeps Portable Fork transcript and duplicate-prevention
records, Project migration receipts, attachment indexes with pending or
unreadable intents and their scratch files, global-state recovery scratch,
and shared upload inventory, journal, and scratch. The upload journal is
still an import source. These protections apply with the acknowledgement.
The original reset policy in the [backend inventory](#backend-inventory)
applies when the legacy flag is omitted.

### Historical writer inventory

Paths below are relative to the original backend's `CODEX_HOME` unless
marked as temporary or remote. Eligible obsolete files have no current writer
or required reader. The remote cache is still regenerable. The reset checks their location, ownership,
filesystem type, and expected layout or contents. Unrecognized contents,
partial JSON/JSONL records, files beyond the inspection bounds, and unexpected
children remain. JSON values and credential contents are omitted from
the printed plan. For a mixed global-state file, the rewrite retains the
original JSON bytes of each preserved member.

| Scope and artifact | Original purpose and writer | Disposition with `--include-legacy` |
| --- | --- | --- |
| Legacy profile, `.codex-global-state.json` key `first-launch-plugins-card-dismissed` | Retired onboarding card toggle, `24ec6c7` | Remove the boolean member. |
| Legacy profile, global keys `thread-pinned-ids` and `telegram-bridge` | Pre-native WebUI pin list and inline bot configuration, `8dc75bd` and `84d3832` | Remove a string array or a token-only object with acknowledgement. Native `pinned-thread-ids` stays. |
| Legacy profile, `codexapp-turn-metadata/<64 hex>.jsonl` | Per-turn submitted/execution metadata, `eff8682` and `185c60b` | Require acknowledgement. Validate complete JSONL rows with matching fields and provenance. Sidecars can contain unique model and effort evidence. Empty abandoned locks use the normal stale-lock check. |
| All profiles, `codexapp-turn-metadata/<64 hex identity>/<64 hex>.jsonl` | Later sidecars bound to a hash of the App Server endpoint and home, `109c468` to `9dc2470` | Same validation and acknowledgement. Identity hashes have no verified mapping to current profile IDs. |
| Shared, `.cloudflared-install-prompted` | Cloudflare CLI prompt timestamp, `2e61846` | Remove a verified timestamp marker. The installed executable stays. |
| Shared, `codexui-password` | Generated WebUI login password, `0616844` | Require acknowledgement and the historical password format. |
| Shared, `webui-free-mode.json`, `webui-custom-providers.json` | Retired OpenRouter, custom endpoint and OpenCode Zen settings and keys, `e560563`, `4b6dcd9` | Require acknowledgement and a recognized provider schema. Native provider settings in `config.toml` stay. |
| Shared, `skills-sync.json` | Retired GitHub Skills sync credentials, repository mappings and status, `661c874` | Require acknowledgement and recognized fields. Installed skills and checkout data stay. |
| Shared, `telegram-bridge.json` and `telegram-bridge.json.tmp` | Retired bot token, subscriptions and allowlist, `bf47bcd` and `3fd83e2` | Require acknowledgement and a recognized configuration schema. |
| Shared, `telegram-notification-outbox.json`, its `.tmp` and `.<UUID>.tmp` files, and `.lock` / `.worker.lock` directories | Telegram delivery and retries, `3fd83e2` and `4f269e7` | Require acknowledgement. A pending or unverified outbox or scratch file protects the group. Empty abandoned locks use the normal stale-lock check. |
| Shared, `pulse.json` | WebUI Pulse preferences and feedback, upstream `nervmor/codexui` `ff0f8d6` | Require acknowledgement and the historical WebUI schema. Keep the separately sourced `pulse-today.json`. |
| Shared, `codexui-automations/store.json` and `runs/run_<base36 time>_<6 hex>/{events.jsonl,last-message.txt,output-schema.json}` | Standalone upstream WebUI schedules and run results, `nervmor/codexui` `dbbb7cd` and `0f66136` | Require acknowledgement, a verified v1 store, terminal run statuses, and a recognized directory layout. Preserve an unresolved or unverified store and its runs. Cleanup uses fixed paths. Native `automations/` stays. |
| Shared temporary, `codexui-review-patches/<timestamp>-<hex>.patch` | Interrupted Git review patch operations, `3d82d73` | Require acknowledgement and recognizable Git diff bytes. Patches can hold unique edits. |
| Shared temporary, `codex-web-local-schema-<6 characters>/` | Generated App Server RPC catalogs, original `fbc8a66` | Remove private batches with recognized Codex-generated JSON Schemas at the root or under `v1/` and `v2/`. An unexpected file preserves the batch. |
| Shared temporary, `codex-web-local-thread-search-<6 characters>/` | Retired zvec search collection and RocksDB ID map, `c6b4f1d` | Remove private empty batches or batches with the `thread_search` / `content_vec` manifest and recognized collection layout. An unexpected file preserves the batch. |
| Remote, `cache/model-history/v1/<64 hex>.json` | WebUI-generated, regenerable metadata from native rollouts, `88e5bd9` and `b156a0e` | Legacy mode checks the historical execution-evidence schema, including explicitly unspecified values. Native rollout files and the parent cache namespace stay. |

### Protected historical state

| Artifact | Ownership and reason to retain |
| --- | --- |
| Global `thread-titles`, workspace roots and labels, `project-order`, `pinned-thread-ids`, `remote-projects`, `codexapp-native-project-migrations-v1` | Mixed native and historical WebUI state. Project and pin compatibility guards still use migration inputs and receipts. See `7518a4c`, `850246b`, and `eff44c6`. |
| Global `thread-queue-state` and `conversation-transfers-v1` | Deferred prompts may be unsent. Portable Fork uses its records for transcript display, recovery and duplicate prevention. See `30acccc` and `54f281e`. |
| `codexapp-thread-index.json` and scratch with unresolved state, `codexapp-upload-inventory.json`, `codexapp-uploads.jsonl` and inventory scratch | Required or potentially needed for attachment submission recovery, migration and remote upload accounting. See `0d1db25` and `d021528`. |
| `codex-web-uploads/f-<6 characters>/` under the old backend's temporary directory, and remote `codexapp-uploads/` | Historical and current staged attachments may be referenced in native conversations or drafts. When an old backend ran on the App Server host, the old temporary staging directory belongs to that host. See `2f1fb38` and `9b3c7d7`. |
| `accounts.json`, `accounts/<id>/auth.json`, temporary `codexui-account-*` homes, native `auth.json` | Retired account switching and quota checks stored copies of official Codex credentials. See `696372d` and `8b90e98`. |
| `automations/<id>/automation.toml` and `memory.md`, `pulse-today.json` | Native or unverified ownership. The former WebUI heartbeat and cron implementations used the native automation directory. The upstream Pulse feed was read-only. |
| Installed Skills, `.skills-sync-remotes/`, temporary `codex-skills-{seed,sync-pull,sync-push}-*` | User Skills and Git working copies. The old sync directory and scratch checkouts can contain unpublished edits. |
| `state_*.sqlite`, native project databases, `session_index.jsonl`, `sessions/`, `archived_sessions/` | Some older builds updated native databases or imported conversations here. Imported histories have the same ownership as other native conversations. |
| Native config, instructions and MCP data, user repositories, `worktrees/`, `rollbacks/`, `prompts/`, exported ZIP/Markdown, HTTPS certificates and tunnel binaries | User or shared tool data at native, checkout, or user-selected paths. A temporary `codexapp-dev-home-*` can also contain any of these files or native sessions. |
| Browser state | Follow [the browser procedure](#clear-browser-state) for each origin and browser profile. |

The audit covered every ref available in this checkout, including its
non-shallow history through `fbc8a66`, release tags, archives and the inherited
`friuns2` ref at `30116bc`. It also examined the accessible upstream refs
for `nervmor/codexui` through `159d02c` and `pavel-voronin/codex-web-local`
through `df9de5c`. The live `friuns2/codexUI` remote required credentials,
so its coverage is grounded in the inherited history. The audit traced
filesystem writes and renames, database and temporary-directory creation,
remote file RPCs, and browser persistence writers. Historical test fixtures,
in-process caches and user-selected export destinations do not add automatic
deletion targets. Add future source-backed discoveries to the
[internal registry](../scripts/reset-webui-legacy-registry.mjs) with a
validated location and deletion policy.

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

Add `--include-legacy` to both commands to verify historical cache formats
on that host. The legacy flag preserves old staging directories and uploads
by default. Run the backend command and App Server command directly on their
respective hosts.

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

Repeat these steps for each browser profile and each exact WebUI origin
(scheme, host and port), including old ports and tunnel origins. The Node
reset never reads a browser profile. Export drafts, prompt presets, terminal
commands, and other settings you want to retain. Before deleting any queue
receipt, reconcile its client message ID against the native queue and thread
history using the WebUI recovery flow. Preserve unresolved or unreadable
receipts and any migration inputs you still need.

1. Close other WebUI tabs and installed WebUI windows. Use the developer
   tools' **Application** or **Storage** panel from a passive same-origin page,
   such as the password prompt without signing in. Avoid a page controlled
   by a running composer.
2. In **Local Storage**, find the keys listed below. The base prefix is
   `codex-web-local.`. A named profile uses
   `codex-profile.<encoded profile ID>.codex-web-local.` for its profile keys.
   For a named-profile-only reset, delete only that profile's entries.
   Unprefixed shared settings are shared across named profiles. For a
   legacy-only reset, preserve unprefixed shared settings and use the
   [storage ownership table](browser-persistence.md#current-key-disposition-and-runtime-owners)
   to identify legacy profile keys. Where old versions reused an unprefixed
   key for multiple purposes, retain it unless shared cleanup is in scope.
3. In **Session Storage**, remove the WebUI `codex-web-local.tab-id.v1` and
   matching draft `thread-draft.v2.<encoded thread>.resume` pointers. Closing
   the corresponding tab releases its session storage. A named-profile-only
   reset should leave a shared tab ID alone in any tab you keep open.
4. In **IndexedDB**, open `codex-web-local.persistence.v1`, object store
   `records`. Remove the selected profile's `prompt-library.v1` record
   after exporting anything you need. Keep `queue-submissions.v1` records
   and their localStorage counterparts until reconciled. An empty IndexedDB
   receipt can mask an older Local Storage receipt. To clear a reconciled
   record, remove the old Local Storage input before deleting the IndexedDB
   record so the old receipt cannot reappear. Delete the database itself
   only when every profile is in scope and no recovery record needs it.
   The retired `codex-web-local.persistence-locks.v1` database with store
   `locks` can be deleted for an origin-wide reset after closing all WebUI
   tabs. A blocked deletion means another page still has the database open.
5. For shared cleanup, remove the verified WebUI cookies `portal_session`
   and the older `codex_web_local_token` for the matching host and path `/`.
   Cookies can affect other ports on the same host. Leave ambiguous
   cookies alone. Backend removal of `webui-auth-sessions.json` revokes
   persisted WebUI login tokens.
6. For shared cleanup, remove only the WebUI Cache Storage entries
   `codexweb-shell-v1`, `codexweb-shell-v2`, `codexweb-shell-v3`,
   and `codexweb-assets-v1`, then unregister the verified WebUI `/sw.js`
   registration for that deployment's scope. Keep other apps' workers and
   caches. The current worker already retires these old caches.
7. Open the unsuffixed WebUI origin in a fresh tab, without an old thread
   route or `connection-profile` query parameter. Verify that the intended
   preferences reset and pending recovery information is still accessible.

### Retired Firebase sign-in

The GitHub Skills integration used Firebase Auth before `1584c9f`. When
shared browser cleanup is in scope, match records to the deployed build's
`firebaseConfig` in `src/composables/useGithubSkillsSync.ts` and its Firebase
app name. The built-in configuration used `[DEFAULT]`. In **Local Storage**,
**Session Storage**, and IndexedDB's `firebaseLocalStorageDb` database and
`firebaseLocalStorage` store, remove only matching
`firebase:authUser:<apiKey>:<appName>` records and any matching
`firebase:redirectUser:<apiKey>:<appName>` or
`firebase:persistence:<apiKey>:<appName>` records. In the
`firebase-heartbeat-database` database and `firebase-heartbeat-store` store,
remove the matching `<appName>!<appId>` record. Keep Firebase databases and
any records shared with another app or whose owner is unclear. Google and
GitHub login data on other origins are outside this procedure.

The [Firebase Auth default persistence configuration](https://github.com/firebase/firebase-js-sdk/blob/firebase%4012.2.1/packages/auth/src/platform_browser/index.ts)
and [Firebase heartbeat store](https://github.com/firebase/firebase-js-sdk/blob/firebase%4012.2.1/packages/app/src/indexeddb.ts)
define these locations.

### Local Storage inventory

The suffixes below use the prefixes in step 2. A trailing `.*` denotes
writer-generated per-thread, per-project, or per-tab suffixes.

| Group | Verified key suffixes |
| --- | --- |
| Shared appearance and interaction | `send-with-enter.v1`, `dark-mode.v1`, `chat-width.v1`, `sidebar-collapsed.v1`, `sidebar-width.v1`, `connection-profile.v1`, `ui-language.v1`, `auto-refresh-enabled.v1`, `in-progress-send-mode.v1`, `dictation-click-to-toggle.v1`, `dictation-language.v1`, `dictation-auto-send.v1` |
| Sidebar, project and account display | `collapsed-projects.v1`, `collapsed-projects.v2.*`, `collapsed-folders.v2.*`, `chat-sort-mode.v1`, `sidebar-chat-sort-mode.v1`, `thread-view-mode.v1`, `sidebar-chats-first.v1`, `sidebar-section-expansion.v1`, `sidebar-section-expansion.v2.*`, `accounts-section-collapsed.v1`, `github-trending-projects.v1`, `project-order.v1`, `project-display-name.v1`, `project-sort-mode.v1`, `pinned-project-order.v1`, `pinned-thread-ids.v1` |
| Thread selection, navigation and caches | `selected-thread-id.v1`, `last-active-thread-route.v1`, `thread-read-state.v1`, `thread-unread-cutoff.v1`, `thread-scroll-state.v1`, `thread-groups-cache.v1`, `thread-token-usage.v1`, `skills-hub.cache.v1` |
| Model, permission and mode preferences | `selected-model-id.v1`, `selected-model-by-context.v1`, `selected-model-by-context.v2.*`, `model-preference-by-context.v1`, `permission-profile-by-thread.v1`, `model-usage-order.v1`, `reasoning-by-provider-model.v1`, `explicit-model-contexts.v1`, `explicit-model-contexts.v2`, `collaboration-mode.v1`, `collaboration-mode-by-context.v1`, `collaboration-mode-by-context.v2.*` |
| Drafts, prompt tools and recovery | `thread-draft.v1.*`, `thread-draft.v2.*` including archives, `thread-fork-recovery.v1.*`, `fresh-forks.v1`, `queue-submissions.v1`, `prompt-library.v1`, `prompt-library.v1.revision`, `prompt-history-enabled.v1`, `native-authentication-pending.v1` |
| Git, review and terminal tools | `worktree-git-automation.v1`, `review-pane-file-list-width.v1`, `thread-terminal-open.v1`, `terminal-tabs.v1`, `terminal-quick-commands.v1` |

The original UI storage writers are in `fbc8a66`. Profile namespacing
arrived in `84f0a14`. Transactional storage, per-tab drafts, and retired
PWA storage are documented by `b63525f`, `d0b123e`, `d85c80c`, and
`74ea66a`. Keep unrelated keys and browser-managed data. Clearing the
entire origin would also clear any other apps' state stored there.
