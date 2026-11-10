### Feature: New thread worktree creation supports searchable base-branch selector

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Use a folder that is inside a Git repository with at least two branches (for example `main` and a feature branch).

#### Steps
1. Open the `New thread` screen.
2. Select a project folder that points to a Git repository.
3. Change runtime to `New worktree`.
4. Verify a `Base branch` dropdown appears.
5. Open the dropdown and type part of a branch name in search.
6. Select a non-default branch from the filtered list.
7. Submit the first message to trigger worktree creation.
8. In the opened thread, confirm `cwd` points to a new worktree path under `~/.codex/worktrees/`.
9. In terminal, run `git -C <new-worktree-path> rev-parse --abbrev-ref HEAD` and `git -C <new-worktree-path> merge-base HEAD <selected-base-branch>`.

#### Expected Results
- `Base branch` selector is visible only in `New worktree` mode.
- Dropdown supports search/filter for branch names.
- Worktree creation succeeds and creates a new branch named `codex/<id>`.
- New worktree branch is based on the selected branch (merge-base confirms expected ancestry).

#### Rollback/Cleanup
- Remove temporary worktree after verification: `git -C <repo-root> worktree remove <new-worktree-path>`.
- Delete temporary branch if needed: `git -C <repo-root> branch -D codex/<id>`.

### Phase 9-A: Branch request ownership and stale responses

Prerequisites/setup: use two disposable Git projects with different branch names,
plus a non-Git folder and an empty Git repository. Open browser network tools and
filter requests by `/worktree/branches`; use network throttling for pending requests.

Actions and expected results:
1. Select a Git project and switch Local project → New worktree. Expect exactly
   one branch request for that transition; the dropdown becomes enabled on completion.
2. While its request is pending, select the other Git project. Resolve the newer
   request first. Expect only the newer project's branches and selection; an older
   success or error must not clear them or change loading state.
3. Switch back to Local project during a pending request. Expect the branch control
   to disappear and its late response to have no effect. Switch back to New worktree;
   expect one fresh request and the previous selection retained if still valid.
4. Select a non-Git folder. Expect Local project and no branch request. For an empty
   Git repository, expect an empty disabled branch dropdown after a successful empty response.
5. Check branch fallback: retain a valid selection, otherwise prefer `main`, then
   the first returned branch, then an empty selection. Repeat in light and dark themes.
6. Repeat the first-message and projectless-chat cases; expect unchanged worktree
   creation-before-send ordering and projectless-directory behavior.

Cleanup: restore normal network speed and remove only disposable projects/worktrees.
Automated race/request-count coverage: `src/composables/useNewThreadRuntime.test.ts`.
