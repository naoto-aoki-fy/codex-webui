# Usage and configuration

Build and startup commands are in the [README](../README.md#quick-start).
Start Codex independently; see the [connection guide](external-app-server.md) for
endpoint precedence, SSH tunnels, remote path ownership and supported capabilities.
For development and verification use the [development guide](development.md).

## WebUI version upgrades

WebUI uses the current storage formats and leaves retired settings and files in
place. Automatic upgrades from older WebUI formats are unsupported. Use
**Settings → General → Draft Recovery** to recover saved drafts from earlier
releases, including drafts restored by Fork and Revert. See the
[browser storage guide](browser-persistence.md#draft-ownership-after-changes).

## Browser access

The production CLI defaults to port 5900 and tries subsequent ports when occupied.
Password protection is disabled by default. Pass `--password <pass>` to require
login for every connection, including localhost and Tailscale. Reverse proxies do
not bypass this check. Configure a private network or external reverse proxy for
remote access; the app has no built-in tunnel manager.

For iPhone/iPad Safari, HTTPS through an externally managed Tailscale Serve setup
can provide a secure context and Add to Home Screen support. With the external
Codex server and web backend already running on port 5900:

```sh
tailscale serve --bg 5900
```

Open `https://<your-machine>.<your-tailnet>.ts.net`. Choose the actual backend port
if startup selected another one. Stop Serve using your Tailscale configuration
when no longer needed. Mobile browsers access the App Server host's projects and native history.

## Conversation controls



Immediate mode is the default; during an active turn it uses Steer. Choose
Immediate mode or native Queue mode from **composer + → Send mode**. Queue mode
shows a compact indicator and requires the supported native queue service. Stop
remains available during generation. Earlier history loads on demand. See
[management entry points and send-mode behavior](management-ui.md) for dialogs,
thread-switch resets and the first-message boundary.

The new-thread and existing-thread composers use the App Server's
`model/list` capabilities for reasoning effort choices. They preserve
`supportedReasoningEfforts` order and resolve incompatible selections to
`defaultReasoningEffort` when supported, or the first supported option.
Missing or empty capability metadata disables the selector and leaves effort
selection to the Codex app-server. Reasoning capabilities come from its model catalog. Turns
validate explicit efforts before submission.

## Skills and projects

Use the folder picker or enter an absolute path on the App Server host to choose a
workspace. Existing projects, pins and worktrees remain available in the sidebar.
The [Skills view](installed-skills.md) lists remote installed skills and supports remote Markdown
viewing, enable/disable and composer selection. Install skills outside the app.
See the [implementation specification](../PROJECT_SPEC.md#feature-status) for
implemented, removed and unsupported capabilities.

## Troubleshooting

- Connection errors: check the independent server endpoint, tunnel and login on
  the App Server host using the connection guide. No shared CODEX_HOME is required.
- Remote browser cannot connect: check the printed port, bind address, firewall
  and proxy WebSocket forwarding.
- Web login and Codex login are separate; authenticate Codex outside this app.

## Screenshots

Screenshots are illustrative snapshots; current source and tests define behavior.

![Skills Hub](screenshots/skills-hub.png)
![Chat](screenshots/chat.png)
![Skills Hub Mobile](screenshots/skills-hub-mobile.png)
![Chat Mobile](screenshots/chat-mobile.png)

## Read status

Read status belongs to the connected Codex server. Missing native receipts are
neutral; failed updates remain unread. See [native read receipts](native-codex-cleanup.md).
