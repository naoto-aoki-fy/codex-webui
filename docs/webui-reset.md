# Reset WebUI state

Run the reset tool from the source checkout with the same OS account and storage
environment as the WebUI backend. On Linux that includes any XDG overrides.
The default is a dry run. Review the listed paths before executing on Linux,
after stopping WebUI processes and builds that use the selected directories.

```sh
pnpm reset:webui --profile workstation-b
pnpm reset:webui --profile workstation-b --execute --offline
```

Use the same ID as at backend startup. `CODEXUI_CONNECTION_PROFILE` supplies it
when `--profile` is omitted, and `--all-profiles` selects every ID in the current
storage roots. Both reset per-ID WebUI state, model preferences and known caches.
Saved Portable Fork records are part of the ID's WebUI state. The reset preserves
upload ledgers and journals so retained or uncertain attachments continue to
count against their capacity. Add `--shared` to clear WebUI password sessions
and `--build` to remove generated output from the current checkout.

The tool uses the [WebUI storage layout](connection-profiles-uploads.md#storage-on-the-webui-backend).
Current and historical files under Codex home stay outside the reset. Browser
storage is managed separately. Use a fresh browser profile for a clean browser
session, or use the browser's site-data controls if all drafts and settings on
that origin can be discarded.

## App Server uploads

Only remove uploads after reviewing references as described in the
[upload audit procedure](connection-profiles-uploads.md#conservative-cleanup).
Run the command on the App Server host. The upload root must be the same path
configured for the WebUI attachment workflow. Select exact filenames within the
ID's managed directory. Other uploads, leases and native Codex data are preserved.

```sh
node scripts/reset-webui.mjs --remote --profile workstation-b \
  --remote-upload-root /srv/webui-attachments \
  --remote-upload 1b937cf7-0751-4c14-972a-cedc95270924-notes.txt

node scripts/reset-webui.mjs --remote --profile workstation-b \
  --remote-upload-root /srv/webui-attachments \
  --remote-upload 1b937cf7-0751-4c14-972a-cedc95270924-notes.txt \
  --execute --offline --confirm-remote "$(hostname)"
```

The local account on the App Server must own the selected files. Remote removal
does not release the WebUI's recorded capacity reservations.
