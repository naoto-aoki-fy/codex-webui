> **Historical authentication workflow — not current acceptance criteria.**
> Local login, token promotion and retired provider fallback were removed.
> Authentication is managed in the external server environment; see
> [current verification](../website-docs-misc/external-app-server.md).
> Any still-relevant error rendering must be exercised with that server.

### Docker Codex authentication and error overlays

#### Setup
Build/package and install the tarball plus `@openai/codex` in isolated containers with unique localhost ports and disposable homes. Preserve any real credentials outside fixtures.

#### Actions
1. With no auth, confirm UI startup is allowed but chat reports an actionable Codex login error. No alternative provider is selected.
2. With invalid/expired Codex auth, send a turn, confirm a single visible persisted error after reload, and verify no duplicate live overlay. Repeat in light/dark themes.
3. With valid file or Keyring Codex authentication, verify model/reasoning selection, tool approval and streaming through app-server.
4. Seed an old alternative config file and confirm its bytes remain unchanged, Settings has no alternative controls, and no provider proxy/model-catalog requests occur.

#### Cleanup
Stop/remove only test containers and volumes. Never remove real credential files.
