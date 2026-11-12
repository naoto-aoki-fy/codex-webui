# Composer file search: ripgrep dependency

Prerequisites: start the app as described in `docs/development.md`. Create a
scratch workspace containing `.hidden`, `with spaces/file name.txt`,
`.git/config`, and `node_modules/ignored`.

1. Verify `rg --version`, then POST to `/codex-api/composer-file-search` with
   JSON `{ "cwd": "<absolute scratch path>", "query": "" }`.
   Expect HTTP 200 with `.hidden` and `with spaces/file name.txt` in `data`,
   excluding `.git/config` and `node_modules/ignored`.
2. Restart with `CODEXUI_RG_COMMAND` pointing to a working executable whose path
   contains spaces. Repeat the request; expect the same results.
3. In an isolated environment with no PATH or known npm-package ripgrep candidate,
   restart with an invalid `CODEXUI_RG_COMMAND`. Expect startup to succeed and
   the request to return HTTP 500 with installation and override instructions,
   rather than HTTP 200 with empty data. Other app functionality remains available.

Cleanup: stop the scratch instance, remove its workspace, unset the override,
and restore PATH. Do not alter the normal development server's environment.
