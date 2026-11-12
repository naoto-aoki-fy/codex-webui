### Worktree creation requires an existing Git commit

#### Prerequisites/Setup
Use disposable plain, empty Git, and committed Git directories. Record their files, branches and HEADs. Run the app in light and dark themes.

#### Steps
1. Open each directory as an existing workspace.
2. Open its project menu: no permanent-worktree action or naming prompt is available.
3. In the committed repository, select New worktree in the composer and submit a message.
4. Verify the resulting worktree has detached HEAD and the original branch and files are unchanged.
5. POST sourceCwd for the plain and empty repositories to /codex-api/worktree/create.
6. Verify both fail without creating .git, AGENTS.md, commits or worktree directories.
7. Verify existing worktrees can still be opened.

#### Expected Results
Only repositories with a valid start commit can create detached worktrees. No repository initialization, initial commit, generated instructions or adjacent named branch is performed.

#### Rollback/Cleanup
Remove only disposable worktrees with git worktree remove and delete the disposable fixture directories.
