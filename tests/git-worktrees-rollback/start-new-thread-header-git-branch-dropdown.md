# Existing worktree working directories

Setup: an existing Git worktree created outside this application; an existing conversation using it.
Actions: select the worktree folder on home; send a turn; reopen the existing conversation; reload. Inspect home in light and dark themes.
Expected: selected cwd remains the existing worktree. No runtime picker, automatic creation or starting-branch selector appears. Existing branches and worktrees remain intact. POST /codex-api/worktree/create and GET /codex-api/worktree/branches return 404.
Cleanup: remove only the test conversation if desired. Do not remove the worktree.
Performance: removes branch listing requests and worktree creation/rollback commands; folder selection uses existing paths directly. No new requests or timers; live timings not measured.
