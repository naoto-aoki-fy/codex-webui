# Remote Control status and registered clients (31, partial)

Current access and layout/state checks: [management dialogs and send modes](../chat-composer-rendering/management-dialogs-send-modes.md). Detailed tools use the conversation header menu; composer selection uses +; account and connection management use Settings.


Setup: supported independently enabled native service, or intercepted
`node scripts/test-approved-remote.cjs`. Open Settings → Codex Remote Control status.
No calls until Read status. Expect native service status/name. Read registered
clients uses only environment ID returned by that status; no identity means no
client request. Registered devices/last-seen values do not prove current connection.
Exercise empty/error and paginated client states; connection replacement clears
results and invalidates delayed replies. Both themes/three viewports. No
pairing/enable/disable/revoke or tokens are requested/stored/copied. Cleanup: close
fixture; no real devices or network configuration are changed.

Performance: zero startup calls/listeners/polling. One status read and an explicit
50-row client page; max 200 retained rows. Allowlisted display excludes credentials.
Native last-seen units are not inferred. Live service/client status NOT RUN.
