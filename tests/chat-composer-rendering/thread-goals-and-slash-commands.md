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
6. Switch threads while a goal load/save is pending. The old response must not overwrite the new thread's panel. Emit a Goal update during a turn and verify that the status and usage update in the panel. Emit a Goal clear and verify that the summary disappears.
7. Repeat the visible flows in light/dark themes and at 375x812 and 768x1024; verify wrapping and accessible controls.
8. With a saved goal, confirm only one line containing Goal, status, and the objective appears. Use a long, multiline objective: the preview stays on one line with ellipsis and does not widen the composer. Click the summary or focus it and press Enter: the editor shows the full objective, status, and usage. Cancel/save restores the compact line; clear removes it. Reopening via + while editing must preserve unsaved goal input. Confirm Goal… is absent in a new, uncreated conversation.
9. Inspect Goal requests. Opening or closing the menu or editor and completing a turn add no Goal reads. Opening a different thread or reconnecting loads the selected Goal. Switch threads while editing and confirm that the previous editor closes and late responses cannot restore it. For tab indicators, follow [Background conversations, Goals, and pending requests](../thread-loading-state/thread-titles-without-generation.md#background-conversations-goals-and-pending-requests).

## Performance Audit

Opening a conversation or reconnecting reads one Goal for the selected conversation. The panel and tab indicators share that state and use the existing notification stream for changes. Goal events skip the conversation list and history refresh queue. Pending request events reuse the existing approval state and update the indicators locally. Browser fixture request counts confirmed zero additional API calls for Goal completion and pending request notifications in both themes. Turn outcomes retain their existing history synchronization and perform zero Goal reads. State is scoped to the selected conversation, turn correlation retains up to 64 entries, and stale reads are discarded after navigation or a newer event. The feature adds no polling, blocking I/O, or cross-thread fanout. Payload sizes are unchanged. Completion searches the installed skills locally, sorts matching skills, and renders at most 20 rows. Search cost is O(n log n) in the worst case for n matching skills.

## Rollback / Cleanup

Clear the temporary goal, disable plan mode, and remove temporary drafts/skill attachments.
