### Feature: dev2 preserves the external server environment

The filename is historical; random-home isolation was retired.

#### Prerequisites / Setup
- Frozen dependencies installed; port 4187 free.
- Set CODEX_HOME to the same existing directory as an independently started server.
- Set CODEXUI_APP_SERVER_URL to its endpoint.

#### Actions
1. Run `pnpm run dev2 --host 127.0.0.1 --port 4187`.
2. Read the preservation warning and open the printed URL.
3. Read the server's model list and threads.
4. Repeat with CODEX_HOME unset on both processes to use their normal default.

#### Expected Results
- Flags reach Vite; it listens on the requested host/port.
- CODEX_HOME and endpoint are preserved; no temporary home is created.
- The same server state is visible; dev2 does not launch or authenticate Codex.

#### Rollback / Cleanup
Stop the test Vite process and unset test environment variables. Do not delete the shared home.
