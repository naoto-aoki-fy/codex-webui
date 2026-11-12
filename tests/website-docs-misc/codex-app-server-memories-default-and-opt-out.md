# External runtime configuration

Setup: build the CLI and independently start Codex 0.167.2 app-server.
Actions: start with --app-server-url and --no-open. Inspect --help. Pass each removed option: --login, --no-login, --memories, --no-memories, --sandbox-mode read-only, --approval-policy never.
Expected: supported startup connects externally; help omits removed options and Commander rejects them as unknown. Configure authentication, memories and runtime defaults on Codex itself; per-thread permissions remain in the UI.
Cleanup: stop only the test web backend; preserve external server and configuration.
Performance: option parsing only; no runtime requests or persistence added.
