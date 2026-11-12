# External runtime permission defaults

Setup: independently managed Codex server with known sandbox/approval defaults.
Actions: start web app with --app-server-url; open a thread; change its permission settings and send a turn.
Expected: defaults come from Codex; native per-thread settings and approvals remain accessible. Application startup no longer accepts sandbox/approval compatibility flags.
Cleanup: restore per-thread settings; leave server configuration intact.
