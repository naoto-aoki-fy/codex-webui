# Explicit remote worktree creation

Prerequisites: POSIX remote App Server, Git, disposable repository with one commit.
Automation uses injected native RPC against temporary repositories; do not use
real user repositories for validation.

1. Open Conversation tools → Create remote Git worktree. Enter an absolute
   separate destination and a new branch. Preview: verify remote repository,
   pinned HEAD, branch and destination; no write should occur.
2. Try Windows/relative/nested/dot-segment paths, invalid/existing branches,
   non-repositories and unborn/changed HEAD. Reject safely without overwrite.
3. Confirm the exact destination. One native fixed-argv worktree-add occurs with
   Hooks disabled. Verify worktree list, branch, commit and destination root.
   Dirty source files must remain unchanged. No force/reset or cleanup is used.
4. Lose the write response after creation: unknown/partial state, no replay.
   Reconcile the exact worktree. Already-created branches/paths are never removed
   automatically. Native rejection/timeout must retain actionable uncertainty.
5. Disconnect/change project during preflight: no subsequent write may reach a
   replacement connection. Repeat during submission: no stale completion UI.
6. Explicitly choose Set up a new conversation. Native project registration and
   home routing use the verified path; no thread or model turn starts until a
   later user send. Return to the source: history and draft remain intact.
7. Check light/dark at 1280×900, 375×812, 768×1024. Cleanup: temporary fixture
   roots are removed by tests. Manual disposable worktrees may be cleaned with
   native Git externally after inspecting partial state; this UI never deletes.

Commands: `pnpm exec vitest run src/api/createWorktree.test.ts src/api/workingTree.test.ts src/api/workingTree.fixture.test.ts src/api/codexGateway.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-worktree.cjs`.
Screenshots: `output/playwright/risk-13-{1280,375,768}-{light,dark}.png`.
Performance: zero startup calls, three preview reads, seven create/verify calls
including exactly one write; 64 KiB Git outputs, 300 worktrees maximum, 30-second
creation deadline, no polling or subscriptions. Live large-repository timings
were not measured.
