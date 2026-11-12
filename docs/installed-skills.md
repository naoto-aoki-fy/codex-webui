# Installed skills

Install and manage skills outside the web application. The Skills view lists skills already available through the configured Codex App Server. Its catalog and Markdown belong to that server host; no Skills from the web backend's CODEX_HOME are added. Reload the page after external installation. The app does not provide an installer command or external catalog.

Installed skills retain remote SKILL.md viewing, file browsing, enable/disable and selection in the conversation composer. Existing skill files are preserved. MCP status, refresh and authentication are unchanged.

The dedicated GET `/codex-api/skills-hub/search` and POST `/codex-api/skills-hub/install` and `/uninstall` handlers are removed; requests follow the normal unhandled-route behavior, consistent with other retired directory routes. These routes have no documented supported HTTP compatibility contract in PROJECT_SPEC.md. Generated skill RPC schemas and the generic RPC gateway remain available for protocol compatibility.

Performance audit (code-path analysis): removes external CLI spawning, command timeouts, output buffering/parsing, search requests and installation reload requests. Installed discovery uses one skills/list request and catalog descriptions, without Markdown read fanout. Opening SKILL.md uses remote fs/readFile. No local session or Skill traversal is performed. Live latency was not measured.

Verification boundaries and separate-host operating instructions are in the [external server guide](external-app-server.md).
