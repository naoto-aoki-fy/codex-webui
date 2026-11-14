# Auth and Docker Runtime

Current authentication checks: [external server](../website-docs-misc/external-app-server.md) and [account panel](../accounts-feedback-observability/accounts-panel-codex-login-callback-modal.md).

The former local-process/provider Docker matrix below is historical; do not run it as current acceptance. Retained refresh compatibility is covered by `src/server/codexAppServerBridge.authRefresh.test.ts`.

Return to the [manual test index](../../tests.md).

Current optional container workflow: [fast container with an external App Server](fast-external-server.md).

## Historical references (excluded from current acceptance)

| Section |
| --- |
| [Feature: CLI no longer requires codex login on startup](cli-no-longer-requires-codex-login-on-startup.md) |
| [Codex authentication error messages](raw-auth-provider-error-messages.md) |
| [ChatGPT auth tokens refresh for external auth](chatgpt-auth-tokens-refresh-for-external-auth.md) |
| [Fresh Docker mobile install does not show rate-limit request failures](fresh-docker-mobile-install-does-not-show-rate-limit-request-failures.md) |
| [Pending first-turn materialization after live-state retirement](docker-auth-startup-live-state-pending-read.md) |
| [Invalid or expired auth errors appear in chat](invalid-or-expired-auth-errors-appear-in-chat.md) |
| [Docker Codex authentication and error overlays](docker-provider-checklist-and-live-error-overlay-regression.md) |
| [Copied auth promotes community fallback to Codex](copied-auth-promotes-community-fallback-to-codex.md) |
| [Codex-only client preserves historical conversations](docker-auth-promotion-preserves-legacy-zen-threads.md) |
