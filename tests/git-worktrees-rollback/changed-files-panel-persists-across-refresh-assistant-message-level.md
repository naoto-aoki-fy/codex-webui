### Feature: Changed-files panel persists across refresh (assistant message level)

#### Prerequisites
- App server running from this repository.
- Existing thread in `TestChat` project with completed assistant messages.
- Worktree rollback auto-commit enabled.

#### Steps
1. Open a `TestChat` thread and confirm assistant message cards render.
2. Verify changed-files panel is shown at the end of assistant messages that have rollback commit data.
3. Hard refresh the page.
4. Re-open the same `TestChat` thread.
5. Verify changed-files panel is still shown for the same assistant message(s).
6. Expand one file diff and verify diff content loads.

#### Expected Results
- Changed-files panel is attached to assistant messages (not transient worked separators).
- Changed-files panel appears only once per turn (on the last assistant message in that turn).
- Changed-files panel is hidden while a turn is still in progress.
- Panels remain available after refresh/restart because lookup is turnId/message-hash based.
- File diff expansion still lazy-loads and displays content.

#### Rollback/Cleanup
- No cleanup required.

### Characterization: Consolidated conversation file-change index (phase 9-B)

- Setup: Use an external app-server and a disposable Git workspace with a thread containing multiple completed file-change items in one turn and a final assistant response. Include a repeated path and a moved file if supported by the server.
- Actions: Open the thread; expand its changed-files summary. Check file ordering and move destinations. Click Undo, then Redo, and refresh the thread. Also inspect a completed turn without a final assistant response.
- Expected: Metadata takes precedence over assistant file-change data on the last assistant anchor; earlier metadata rows are hidden. Without an assistant anchor, only the last metadata row displays the grouped summary. Repeated path/destination pairs aggregate in encounter order, with added files before updated and deleted files. Undo/Redo affects only the selected turn and restores the same patches; refresh preserves the summary. Missing turn IDs must not enable actions without an effective turn ID.
- Cleanup: Restore the disposable workspace with Redo when applicable, then remove the test workspace/thread.
- Automated coverage: `src/utils/conversationFileChanges.test.ts` characterizes metadata precedence, incomplete identities, multiple summaries per turn, move grouping, ordering, hidden IDs, and frozen inputs. Live Undo/Redo remains a separate external-server check.
