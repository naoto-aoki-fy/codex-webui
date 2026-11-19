# WebUI reset with OS storage and App Server IDs

Use a disposable XDG storage tree on Linux, an empty browser profile, and a
separate disposable Codex home. Start and stop the backend with IDs `one` and
`two` after creating model preferences, inline previews, and, if available,
Portable Fork records. Stage an upload per ID with an explicit disposable upload
root on the App Server. Seed the old Codex home with WebUI and native sentinels.

1. Run `pnpm reset:webui --profile one --shared`. Expect a dry run that names
   ID one's state and caches and the global session store. The plan excludes
   upload ledgers, the second ID, the App Server, and the Codex-home sentinels.
2. With every writer stopped, run
   `pnpm reset:webui --profile one --execute --offline`. Restart and check that
   ID one has fresh backend state, the other ID is unchanged, and both IDs'
   upload inventories and journals still exist. The shared login still works.
3. Stop the backend and run
   `pnpm reset:webui --all-profiles --shared --execute --offline`. Confirm both
   IDs now have fresh backend state and the WebUI requests password login.
   Browser storage and Codex-home sentinels still exist.
4. For the separate App Server-host cleanup, preview one exact disposable
   filename with `--remote --profile one --remote-upload-root <absolute-root>
   --remote-upload <filename>`. Execute with `--execute --offline
   --confirm-remote <hostname>`. Confirm other files and IDs are preserved,
   and the WebUI's accounting is still intact.
5. On macOS and Windows, run
   `pnpm reset:webui --profile one --execute --offline` against disposable
   storage. Expect an immediate Linux-only error and verify the data and
   cache directories retain their contents. The path resolver tests in
   `src/server/connectionProfile.test.ts` cover all three platforms.

Cleanup: remove the disposable directories and browser profile. To retain
saved backend state when testing, stop after the dry-run steps.
