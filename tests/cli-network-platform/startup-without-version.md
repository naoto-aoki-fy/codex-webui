# CLI startup without version output

## Feature/Change Name
Remove the version line and its package metadata read from the CLI startup banner.

## Prerequisites/Setup
Run `pnpm run build` from the repository.

## Steps
1. Run `node dist-cli/index.js --host 127.0.0.1 --port 4192 --no-open` with an unused port.
2. Inspect the terminal startup output.

## Expected Results
- `Codex WebUI is running!`, bind address, App-server address, and local URL appear.
- No `Version:` line appears.

## Rollback/Cleanup
Stop the test server with Ctrl+C.
