# Local builds after npm publishing retirement

## Feature/Change Name

Build the private package and use the supported development wrapper without a worktree/version badge.

## Prerequisites

- Install the project's Node.js and pnpm versions and dependencies.
- Run commands from the repository root. No npm credentials are required.

## Steps

1. Inspect `package.json`: confirm that publishing lifecycle, access, and package file-list settings are absent, repository links point to `naoto-aoki-fy/codex-webui`, and build scripts and CLI binaries remain defined.
2. Confirm that the root release shell script is absent and maintenance scope lists only supported build/development workflows.
3. Confirm `package.json` has `"private": true` and no `version` field. Run `pnpm run typecheck` and `pnpm run build`.
4. Run `node dist-cli/index.js --help`.
5. Run `pnpm run test:integration:fixture`.
6. Start `pnpm run dev --host 127.0.0.1 --port 4173`. Open the home page, expand Settings, and confirm there is no worktree/version badge in either light or dark theme.
7. Edit a visible Vue template, confirm HMR applies it without a page error, then restore the edit.

## Expected Results

- Frontend and CLI builds succeed and produce `dist/` and `dist-cli/`.
- Development startup and HMR work through `scripts/dev.cjs`; the Settings button/panel omit development metadata.
- CLI help lists the supported options and exits successfully. The CLI is ESM, so use its public executable for the entry-point smoke check.
- The credential-free protocol fixture passes.
- Dependency lockfiles and runtime startup behavior remain unchanged. No registry publication is performed.

## Rollback/Cleanup

- No external state is created. Build output remains ignored by Git and can be regenerated with `pnpm run build`.
- Restore the temporary template edit and original theme. Leave any shared development server running.
