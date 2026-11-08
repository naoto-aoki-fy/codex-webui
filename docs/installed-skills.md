# Installed skills

Install and manage skills outside the web application. The Skills view lists skills already available through the configured Codex app-server and the local `CODEX_HOME/skills` directory (default `~/.codex/skills`). Reload the page after external installation. The app does not provide an installer command or external catalog.

Installed skills retain local SKILL.md viewing, file browsing, enable/disable, Try it, and selection in the conversation composer. Existing skill files are preserved. MCP status, refresh and authentication are unchanged.

The dedicated GET `/codex-api/skills-hub/search` and POST `/codex-api/skills-hub/install` and `/uninstall` handlers are removed; requests follow the normal unhandled-route behavior, consistent with other retired directory routes. These routes have no documented supported HTTP compatibility contract in PROJECT_SPEC.md. Generated skill RPC schemas and the generic RPC gateway remain available for protocol compatibility.

Performance audit (code-path analysis): removes external CLI spawning, command timeouts, output buffering/parsing, search requests and installation reload requests. Installed discovery retains its existing single skills/list request and local description reads. No new requests, blocking work, fanout, payloads or caches are introduced; installed-skill refresh behavior is unchanged. Live latency was not measured.

Verification: type checks, all 361 unit tests, production build and credential-free external-server fixture pass. The fixture runs the CommonJS integration script against the public ESM CLI (no public CJS exports) and verifies HTTP RPC, metadata and browser WebSocket transport. DirectoryHub output is 14.43 kB JS (5.08 kB gzip) and 35.85 kB CSS (3.96 kB gzip). Browser checks could not run because the Playwright Chromium executable is absent; real Codex turns, authentication and visual light/dark checks remain unverified.
