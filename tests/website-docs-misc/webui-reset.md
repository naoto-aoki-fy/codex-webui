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
