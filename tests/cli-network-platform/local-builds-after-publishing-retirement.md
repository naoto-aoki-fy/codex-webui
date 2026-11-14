# Local builds after npm publishing retirement

## Prerequisites

- Install the project's Node.js and pnpm versions and dependencies.
- Run commands from the repository root. No npm credentials are required.

## Steps

1. Inspect `package.json`: confirm that publishing lifecycle, access, and package file-list settings are absent, repository links point to `naoto-aoki-fy/codex-webui`, and build scripts and CLI binaries remain defined.
2. Confirm that the root release shell script is absent and maintenance scope lists only supported build/development workflows.
3. Run `pnpm run build`.
4. Run `node dist-cli/index.js --help`.
5. Run `pnpm run test:integration:fixture`.

## Expected Results

- Frontend and CLI builds succeed and produce `dist/` and `dist-cli/`.
- CLI help lists the supported options and exits successfully. The CLI is ESM, so use its public executable for the entry-point smoke check.
- The credential-free protocol fixture passes.
- Dependency lockfiles and runtime/build configuration remain unchanged. No registry publication is performed.

## Rollback/Cleanup

- No external state is created. Build output remains ignored by Git and can be regenerated with `pnpm run build`.
