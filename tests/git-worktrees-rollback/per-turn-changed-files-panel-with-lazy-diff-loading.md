### Feature: Per-turn changed files panel with lazy diff loading

#### Prerequisites
- App server running from this repository.
- Worktree git automation enabled.
- A thread with at least one completed turn that touched files.

#### Steps
1. Open a thread and locate a `Worked for ...` separator message.
2. Expand the worked separator.
3. Verify a changed-files panel appears above command details.
4. Confirm file list entries show file path and `+/-` counts.
5. Click one changed file row to expand it.
6. Verify diff content loads only after expansion (lazy load behavior).
7. Collapse and re-expand the same file row; verify diff reuses loaded content.
8. Switch to another thread and back; verify panel reloads for the active thread context.

#### Expected Results
- Each worked message can show changed files for its turn.
- Diff for a file is fetched only on expand, not for all files upfront.
- Errors (missing commit/diff load failure) are shown inline in the panel.
- Existing command output expand/collapse behavior remains unchanged.
- Changed-files panel still resolves after page refresh or app-server restart.
- Changed-files panel appears at the end of the worked message block (after command rows).

#### Rollback/Cleanup
- No cleanup required.

### Regression: Extracted diff viewer line parser

#### Prerequisites / Setup
- Run `pnpm exec vitest run src/utils/diffViewerLines.test.ts`.
- For manual checks, use a thread containing added, deleted, and updated files, including a multi-hunk update.

#### Exact Actions
1. Open each file in the conversation diff viewer in light theme.
2. Check unified headers, context, additions, removals, and old/new line numbers across multiple hunks.
3. Check added/deleted file contents and switch between files in the viewer.
4. Repeat in dark theme, then close the viewer and switch threads.

#### Expected Results
- All seven parser regression cases pass.
- Diff text, row markers, line numbers, selected file, and styling remain unchanged.
- Closing the viewer and switching threads preserve existing conversation behavior.

#### Rollback / Cleanup
- Close the viewer. No persistent data is created by parsing or the automated tests.
