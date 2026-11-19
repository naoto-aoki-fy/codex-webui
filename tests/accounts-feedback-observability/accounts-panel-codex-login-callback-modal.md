# Native Codex account controls and submission

Use a disposable, independently managed App Server and account, or run
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-account-settings.cjs`
against this checkout's dev server on `http://127.0.0.1:4173`. The script uses
intercepted native responses. Record the Codex version for a live run. Check light
and dark themes at 1280×900, 375×812 and 768×1024.

1. Start signed out and open a test conversation. Submit a prompt before opening
   Settings. Expect one native turn request and a visible native authentication
   error if the server rejects it. Expect zero `account/read` calls during
   startup or submission.
2. Open Settings → Codex account. Expect an on-demand display-only account read.
   Choose ChatGPT browser sign-in, confirm and start. Expect a native authorization
   link. Close Settings and submit again while sign-in is pending. Expect one
   native request and the App Server's response, with zero additional
   `account/read` calls. Reopen Settings and cancel.
   Expect one native cancellation with the original login ID and the link to clear.
3. Start device-code sign-in. Expect the native link and code. A completion for a
   different login leaves both visible. A matching failed completion clears them
   and displays the native error. Retry deliberately and complete the matching
   login successfully. Expect the display name and signed-in account.
4. While idle, click Logout. Expect one native logout and a signed-out account.
   Close Settings, disconnect and reconnect, then submit again. Expect one
   native request for the new prompt and zero `account/read` calls. A failed
   login or logout RPC should display its error in Account settings.
5. Use the bridge fixture to verify that legacy token/session RPCs are blocked
   and that account and login replies expose only display metadata or the native
   sign-in challenge. Browser fixture screenshots appear under
   `output/playwright/native-account-<width>-<theme>.png`.

Cancel any remaining disposable sign-in, close the browser context and restore
the original theme. Stop only disposable live test processes.
