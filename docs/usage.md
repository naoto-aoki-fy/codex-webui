# Usage and configuration

Build and startup commands are in the [README](../README.md#quick-start).
Start Codex independently; see the [connection guide](external-app-server.md) for
endpoint precedence, shared filesystem requirements and compatibility flags.
For development and verification use the [development guide](development.md).

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
when no longer needed. Mobile browsers access the host's filesystem and sessions.

## Conversation controls

Messages submitted during an active turn use Steer immediately. There is no deferred
prompt queue; legacy queue data and the former busy-send preference are ignored.
Stop remains available during generation. Earlier history loads on demand.

The new-thread and existing-thread composers use the App Server's
`model/list` capabilities for reasoning effort choices. They preserve
`supportedReasoningEfforts` order and resolve incompatible selections to
`defaultReasoningEffort` when supported, or the first supported option.
Missing or empty capability metadata disables the selector and leaves effort
selection to the Codex app-server. Reasoning capabilities come from its model catalog. Turns
validate explicit efforts before submission.

## Skills and projects

Use the searchable folder picker or project creation/clone dialog to choose a
workspace. Existing projects, pins and worktrees remain available in the sidebar.
The [Skills view](installed-skills.md) lists installed skills and supports local
viewing, enable/disable and composer selection. Install skills outside the app.
See the [implementation specification](../PROJECT_SPEC.md#feature-status) for
implemented, removed and unsupported capabilities.

## Telegram Completion Notifications (Optional)

In Settings → Telegram, enter a bot token and one destination chat ID, enable
completion notifications, and save. Use **Send Test Notification** to check delivery.
The optional application URL adds a conversation link; use an address reachable
from your phone. Negative group chat IDs are also supported.

The running backend observes successful `turn/completed` events, including turns
submitted from the browser, even after the browser closes. A completed turn does not
guarantee the whole requested task succeeded. Failed and interrupted turns do not
notify. Telegram cannot create, select, read, or modify conversations, and incoming
messages and bot commands are not processed.

Existing tokens and completion settings remain in `<CODEX_HOME>/telegram-bridge.json`.
Legacy fields are ignored and preserved on disk when saving; stored files are not
deleted. Existing notification destinations and enabled state are retained. Legacy
chat lists and allowlists do not automatically become notification subscriptions.
Only the first explicitly configured notification destination is used.

The persistent `telegram-notification-outbox.json` retains pending completion alerts
and the last 2,000 settled delivery keys across restarts. Legacy conversation-forwarding
jobs are ineligible and never sent. Requests time out after 15 seconds; temporary
failures retry with exponential backoff and Telegram retry-after delays, up to ten
attempts within 24 hours. Permanent API failures stop retrying. The queue holds up
to 1,000 pending alerts and exposes delivery errors in settings.

Duplicate events are suppressed within the receipt window. Telegram can still
receive a duplicate if it accepts a message but its response is lost before the
backend records delivery. Disabling notifications stops the worker and all
background Telegram requests; pending alerts are rechecked when enabled again.
A test notification is an explicit request and works while completion alerts are disabled.
No events are monitored while the backend is stopped.

Telegram uses a dedicated connection pool with a 3-second IPv4/IPv6 connection
attempt delay (Node.js 18.18+). Explicit Node network family flags take precedence.
Connection logs redact bot tokens.

## Troubleshooting

- Connection errors: check the independent server endpoint and matching user,
  CODEX_HOME and paths using the connection guide.
- Remote browser cannot connect: check the printed port, bind address, firewall
  and proxy WebSocket forwarding.
- Web login and Codex login are separate; authenticate Codex outside this app.

## Screenshots

Screenshots are illustrative snapshots; current source and tests define behavior.

![Skills Hub](screenshots/skills-hub.png)
![Chat](screenshots/chat.png)
![Skills Hub Mobile](screenshots/skills-hub-mobile.png)
![Chat Mobile](screenshots/chat-mobile.png)
