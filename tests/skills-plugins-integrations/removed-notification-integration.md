# Removed notification integration

Setup: use an isolated CODEX_HOME and an independently managed app-server for live conversation checks. Never copy real bot credentials. Optionally create malformed `telegram-bridge.json` and `telegram-notification-outbox.json` files, plus an unrelated setting in `.codex-global-state.json`.

1. Start the application. Open Settings in Light and Dark appearance. Expect account, appearance, language and context controls to work, with no Telegram controls or notification errors.
2. Refresh after changing appearance. Expect the selected appearance to persist.
3. Request GET and POST on `/codex-api/telegram/config`, `/configure-bot`, `/status`, and `/test-notification` (each under the same Telegram prefix). Expect JSON 404 responses, no configuration or credentials.
4. Create a thread and finish a turn using the external app-server. Expect normal streaming, approvals when needed, and completion state. Inspect network traffic: no Telegram requests or status polling.
5. Restart. Expect obsolete files and unrelated settings to remain intact and no notification retries or startup errors.

Cleanup: stop the isolated test server and delete only the temporary CODEX_HOME. Restore appearance if using an existing browser profile.

Performance audit: removal eliminates two initial settings/status HTTP requests, the settings panel's 10-second status polling, its completion-event subscriber, and the persistent outbox worker/network pool. No replacement fanout, payload, blocking disk work or cache is added. Legacy files are never read. Live provider latency is outside the fixture's scope.
