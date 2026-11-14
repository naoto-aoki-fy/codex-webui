# External connection errors and retired local CLI diagnostics

Setup: disposable browser profile, an external Codex server, and no local Codex
executable in the WebUI host PATH. See the [external-server procedure](../website-docs-misc/external-app-server.md).

1. Connect and open composer settings in light and dark themes. Expect native
   models and no local CLI installation/configuration banner.
2. Disconnect the external server. Expect connection/authentication guidance from
   the active error path. Reconnect; expect recovery without duplicate submissions.
3. Lose the response after an accepted submission. Expect an unknown-outcome
   warning and no automatic resend. Inspect native history before retrying.

Cleanup: restore connectivity and remove only disposable test data. Never stop
or restart the persistent 5173 server for this check.
