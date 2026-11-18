# Native goals, plan mode and skill completion

## Prerequisites / Setup

- Use an app-server supporting `thread/goal/get`, `thread/goal/set`, and `thread/goal/clear`.
- Open an existing thread and install at least one enabled skill.

## Actions and Expected Results

1. Open **+ → Plan mode**. Toggle it and confirm the Plan chip appears without sending a message. Select the chip to return to default mode.
2. Type a skill name after `/` and select it: a skill chip appears and the completion token is removed. Disabled skills are absent; at most 20 suggestions appear.
3. In a disposable fixture without matching skills, submit each of `/prompts`, `/presets`, `/history`, `/help`, `/review`, `/compact`, `/diff`, `/processes`, `/goal` and `/plan`. Expect the normal submit payload to contain the exact text and no command-driven dialog or mode change.
4. In an existing thread without a goal, confirm no goal panel or empty panel spacing appears. Open + and select Goal… below Plan mode: the menu closes and the editor opens above the composer with the objective focused, without sending a turn or changing the message draft. Cancel: the panel disappears. Save an objective and status, reload, and confirm persistence.
5. Edit status and clear the goal: the returned server state is reflected. A failed save/clear keeps the editor open and displays an error.
6. Switch threads while a goal load/save is pending: the old response must not overwrite the new thread's panel. Complete a turn: the goal and usage refresh once.
7. Repeat the visible flows in light/dark themes and at 375x812 and 768x1024; verify wrapping and accessible controls.
8. With a saved goal, confirm only one line containing Goal, status, and the objective appears. Use a long, multiline objective: the preview stays on one line with ellipsis and does not widen the composer. Click the summary or focus it and press Enter: the editor shows the full objective, status, and usage. Cancel/save restores the compact line; clear removes it. Reopening via + while editing must preserve unsaved goal input. Confirm Goal… is absent in a new, uncreated conversation.
9. Inspect goal requests: opening/closing the menu or editor adds no reads; thread changes and completed turns retain the existing refresh behavior. Switch threads while editing: the previous editor closes and late responses cannot restore it.

## Performance Audit

Code-path analysis only: one goal RPC per panel mount/thread change and one on a running-to-idle transition. The panel component remains mounted when its visible section is hidden, so menu/editor toggles do not trigger new reads or invalidate cached state. No polling, new event stream, filesystem calls, blocking I/O, or fanout. Mutation responses update the panel directly without an additional read. Generation checks discard stale responses; there is no cross-thread goal cache. Goal data is a single object; payload size is unchanged. Collapsed rendering contains only the status and objective preview, with no additional list traversal. Completion searches the installed skills locally, sorts matching skills, and renders at most 20 rows; it adds no network calls. Search cost is O(n log n) in the worst case for n matching skills.

## Rollback / Cleanup

Clear the temporary goal, disable plan mode, and remove temporary drafts/skill attachments.
