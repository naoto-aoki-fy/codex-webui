> **Historical authentication workflow — not current acceptance criteria.**
> Local login, token promotion and retired provider fallback were removed.
> Authentication is managed in the external server environment; see
> [current verification](../website-docs-misc/external-app-server.md).
> Any still-relevant error rendering must be exercised with that server.

### Raw Codex authentication error messages

#### Feature/Change Name
Surface upstream auth/provider errors without rewriting them in the client normalizer.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A provider/backend request that can return an error

#### Steps
1. Trigger a Codex backend error, such as an authentication refresh failure
2. Observe the surfaced error text in the UI/failed RPC path

#### Expected Results
- Error text matches the original upstream/backend error message
- No replacement copy like `Authentication session conflict detected...` is injected

#### Rollback/Cleanup
- Restore provider/session settings to the preferred state

---
