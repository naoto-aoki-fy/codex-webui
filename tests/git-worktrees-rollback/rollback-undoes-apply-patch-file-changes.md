### Feature: Rollback undoes apply_patch file changes

#### Prerequisites
- App is running from this repository (`pnpm run dev`).
- A thread exists with at least one completed turn that applied file changes via `apply_patch`.
- The thread's `cwd` points to a git-tracked directory.

#### Steps
1. Open a thread with file changes visible in the conversation (file change cards with diffs).
2. Note the current state of a file that was modified by the agent in a recent turn.
3. Click the rollback button on a turn that has file changes.
4. After rollback completes, check the file on disk — it should be restored to the state before the agent modified it.
5. Verify the thread conversation no longer shows the rolled-back turns.
6. For turns that added new files: verify the added files are deleted from disk.
7. For turns that deleted files: verify Undo reports a missing per-turn preimage and leaves current files intact.

#### Expected Results
- Clicking rollback on a turn reverts both the thread history AND the file system changes from that turn and all subsequent turns.
- Files modified by `apply_patch` are reversed only when their patch postimage matches current content.
- Files created by `apply_patch` are removed only when current bytes match the expected addition.
- Deleted files without a per-turn preimage are refused; HEAD is never used as a restoration fallback.
- File moves in rolled-back turns are reversed (moved file is renamed back to original path).
- If file revert fails (e.g., not a git repo), the thread rollback still proceeds — file revert is best-effort.
- The rollback-files endpoint (`POST /codex-api/thread/rollback-files`) can be called independently for testing.

#### Rollback/Cleanup
- No cleanup required — rolled-back files are already restored.

### Feature: Chat file-change undo and redo

#### Prerequisites
- App is running from this repository (`pnpm run dev`).
- A thread exists with at least one completed assistant turn that applied file changes via `apply_patch`.
- The thread's `cwd` points to a writable worktree.

#### Steps
1. Open a thread with a visible file-change summary under an assistant response.
2. Expand the file-change summary, identify one changed file, and save its current contents with `cat <file> > /tmp/file-before-undo.txt`.
3. Confirm the file-change action row shows `Undo` and does not show a separate `Redo` button.
4. Click `Undo` in the file-change action row.
5. Confirm the button enters an `Undoing` pending state and then changes to `Redo`.
6. Verify the file contents on disk are restored to the pre-turn state with `diff -u /tmp/file-before-undo.txt <file>`.
7. Click `Redo` in the same file-change action row.
8. Confirm the button enters a `Redoing` pending state and then changes back to `Undo`.
9. Verify the file contents on disk match the assistant turn's changes again with `cat <file>` or a diff against the assistant-modified snapshot.
10. Repeat steps 1-9 in light theme and dark theme.

#### Expected Results
- Undo reverts the file changes applied by the selected turn without changing chat history.
- Redo reapplies the previously run `apply_patch` input without changing chat history.
- The file-change action row shows exactly one action button at a time: `Undo` before rollback, `Redo` after undo, and `Undo` again after redo.
- If Undo fails, the inline error stays visible and the single action still switches to `Redo` so the user can reapply or recover the visible action state.
- Any backend error appears inline in the file-change panel.
- The action row uses themed controls that remain readable in light and dark theme.

#### Verification Evidence
- Light screenshot: `output/playwright/chat-file-changes-failed-undo-single-redo-light.jpg`.
- Dark screenshot: `output/playwright/chat-file-changes-failed-undo-single-redo-dark.jpg`.
- Browser runtime profile: `output/playwright/browser-runtime-profile-home-2026-05-20T03-11-53-121Z.json`.
- Profile result on `http://127.0.0.1:4173/`: `warnings: []`, `threadReadDuplicateKeys: 0`, `totalApiKB: 337.9`.
- Code-path audit: file-change action state is component-local and keyed by thread plus turn, so it does not add startup or thread-list requests. Undo/redo server work is request-scoped, bounded to collected patch inputs for the selected turn or explicit patch subset, and uses sequential filesystem operations without background fanout.

#### Rollback/Cleanup
- Click `Undo` again if the test should leave the worktree without the assistant's file changes.

### Verification: Pure patch helper extraction

#### Prerequisites
- Dependencies are installed in the current checkout.

#### Steps
1. Run `pnpm exec vitest run src/server/turnFilePatches.test.ts src/server/threadFileChangeRetirement.test.ts`.
2. Run `pnpm run typecheck`, `pnpm run build`, and `pnpm run test:unit`.
3. Run `pnpm run test:integration:fixture`, then run `CODEXAPP_FIXTURE_TRANSPORT=unix pnpm run test:integration:fixture` sequentially.

#### Expected Results
- Characterization tests preserve ordered additions, deletions, updates, moves, malformed headers, missing context, whitespace, EOF handling, and forward/reverse asymmetry.
- Public rollback-files requests preserve patch filtering, operation counts, partial failure errors and patch IDs; unsafe Undo refuses restoration rather than using Git fallback.
- Both transport fixtures pass for the built CLI and dev entry point.

#### Rollback/Cleanup
- Automated file-operation tests use temporary repositories and remove them after each case. No user worktree files need restoration.

### Verification: Preservation-first Undo

Prerequisites: use only a disposable worktree and a completed patch turn; retain
copies of expected before/after content. Never exercise these cases on user data.

1. Undo a clean update, addition and move; verify exact before content and paths.
2. Repeat after staging unrelated edits and making additional unstaged edits;
   verify index bytes remain identical and unrelated working content survives.
3. Edit the patch's added file or conflicting update content, or recreate a move's
   original path. Undo must report an error without replacing that content.
4. Undo a deletion or command-only change without a per-turn preimage. Expect a
   refusal. Selecting an independent patch must not affect command-only paths.
5. Select multiple patches with one conflict. Successful independent operations
   may complete; errors identify failed paths and incomplete patch IDs are absent
   from `revertedPatchIds`. Repeat Undo and verify no fallback restoration occurs.
6. Run the focused helper/bridge tests, including the deterministic pre-validation
   editor conflict and accepted post-validation race, then the full checks above.

Expected: Redo behavior and response shapes remain unchanged. No Git index writes
or HEAD restoration occur during Undo. An external writer can still race final
validation and mutation; this accepted limitation is not complete loss prevention.
In-place updates retain existing inode permissions/hardlink behavior; they are not
transactional or crash-safe. Temporary replacement is deferred because it changes
those semantics. Rename destinations use exclusive creation to reject collisions.

Cleanup: remove the disposable fixture/worktree after retaining test evidence;
do not use Redo as a backup or conflict recovery mechanism.
