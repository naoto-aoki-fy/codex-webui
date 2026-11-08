> **Historical authentication workflow — not current acceptance criteria.**
> Local login, token promotion and retired provider fallback were removed.
> Authentication is managed in the external server environment; see
> [current verification](../website-docs-misc/external-app-server.md).
> Any still-relevant error rendering must be exercised with that server.

### Codex-only client preserves historical conversations

Use an isolated home containing a copy of a conversation with legacy provider metadata and official Codex authentication. Open the conversation and verify message history remains readable without registering or contacting the old provider. Select a supported Codex model and resume; runtime requests use official `openai`. Existing historical metadata and configuration files are not migrated or deleted. Legacy persisted prompt entries must never execute, including entries for removed providers. Repeat in both themes and remove only disposable copies afterward.
