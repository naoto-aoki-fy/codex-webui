# Current remote Git working tree (12)

Open **Conversation tools** in the selected conversation before expanding the feature panel.

Setup: supported remote command/exec, Git on the server, a disposable repository
with staged/unstaged, renamed/deleted, binary, large and untracked files.
Open a conversation in that project, expand Current Git working tree, refresh.
Expect exact remote cwd and refresh timestamp, separate staged/unstaged controls,
and untracked status. Select each patch; binary files show Git's binary notice,
large patches are bounded with a truncation warning, deleted/renamed files retain
status. Untracked content must be requested only by its Preview button.
Refresh a non-repository: visible error, no clean-state claim. Navigate/change
connection during delayed reads: old data must not appear in the replacement scope.
Fixture command: `node scripts/test-approved-panels.cjs` (Playwright browser path as
configured locally), all three sizes and both themes. Cleanup: close fixture;
remove only designated disposable test repository if created externally.

Performance: no startup/polling calls. One 64 KiB capped, 10s remote status command
per refresh; one capped patch per selection; maximum 300 paths, serial in-flight
UI guard. Native fs/readFile lacks size/ranged reads, so untracked previews use
bounded remote git diff --no-index rather than eager full-file reads. No new
server route, cache, local Git or filesystem operation. Live latency NOT RUN.
