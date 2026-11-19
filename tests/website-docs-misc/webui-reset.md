# WebUI reset

Prerequisites. Use a disposable Linux state directory, temporary directory, and
browser profile. Set `CODEX_HOME` and `TMPDIR` for the WebUI and reset to these
directories. Start the WebUI against a disposable App Server. Set a WebUI
password, sign in, change a WebUI setting, and save an unsent draft. Put
sentinels in `$CODEX_HOME/config.toml` and an unrelated Local Storage key.
Record their contents.

1. Run `pnpm reset:webui --all-profiles --shared --dry-run`. Confirm the local
   hostname, paths, and individual WebUI entries show up in the plan.
   Confirm the backend's session file and both sentinels still exist.
2. Run `pnpm reset:webui --all-profiles --shared --execute --offline` while the
   disposable backend is running. It should refuse to make changes.
3. Close the app tab and stop the backend. Run the same execution command.
   Confirm the reported WebUI session file was deleted and the configuration
   sentinel was preserved. Rerun and check that it reports zero actions.
4. Restart the backend and follow the browser steps in the
   [reset guide](../../docs/webui-reset.md#clear-browser-state). Open a fresh
   tab. Confirm the old password session no longer authorizes access, the
   changed WebUI setting is at its default, and the unsent draft is absent.
   Confirm the unrelated Local Storage sentinel remains and a native test
   conversation is still readable after signing in.

Cleanup. Stop the disposable backend and App Server, remove the disposable
test directories, and discard the test browser profile.

## Historical WebUI state

Prerequisites. Use disposable backend and App Server homes and a disposable
temporary directory. In the backend home, write `1712345678901` plus a
newline to `.cloudflared-install-prompted` and write
`{"enabled":true,"apiKey":"fixture","model":"old"}` to
`webui-free-mode.json`. Put a native sentinel alongside
`first-launch-plugins-card-dismissed` in `.codex-global-state.json`.
Stop all writers for both fixture homes.

1. Run `pnpm reset:webui --all-profiles --shared --dry-run`. Expect neither
   historical file nor the historical global member in the deletion plan.
2. Add `--include-legacy`. Expect the marker and onboarding member in the
   plan and a preservation message for the provider file. Add
   `--acknowledge-legacy-data-loss` and confirm the provider file appears.
3. Run the acknowledged command with `--execute --offline` in place of
   `--dry-run`. Expect both retired files to be removed and the native
   sentinel to retain its bytes. Repeat and expect zero filesystem actions.
4. On the separate App Server host, preview
   `node scripts/reset-webui.mjs --remote --remote-codex-home /path/to/fixture --include-legacy --dry-run`.
   Expect only verified rollout caches in the plan unless an existing
   explicit upload selection was supplied. Keep old staging and native
   attachments. Repeat for the browser profile using the
   [historical browser inventory](../../docs/webui-reset.md#clear-browser-state).

Cleanup. Remove the disposable fixture homes and temporary directories, and
discard the disposable browser profile.
