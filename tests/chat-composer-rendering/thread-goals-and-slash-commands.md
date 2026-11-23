# Native goals, plan mode and skill completion

## Prerequisites / Setup

- Use an app-server supporting `thread/goal/get`, `thread/goal/set`, and `thread/goal/clear`.
- Open an existing thread and install at least one enabled skill.

## Actions and Expected Results

1. Open **+ → Plan mode**. Toggle it and confirm the Plan chip appears without sending a message. Select the chip to return to default mode.
2. Type a skill name after `/` and select it: a skill chip appears and the completion token is removed. Disabled skills are absent; at most 20 suggestions appear.
3. In a disposable fixture without matching skills, submit each of `/prompts`, `/presets`, `/history`, `/help`, `/review`, `/compact`, `/diff`, `/processes`, `/goal` and `/plan`. Expect the normal submit payload to contain the exact text and no command-driven dialog or mode change.
4. In an existing thread without a goal, confirm there is no Goal chip or empty row. Enter a message draft, open **+ → Goal…**, and confirm a dialog titled **Goal settings** opens at the same size as Settings with the objective focused. Use **Cancel**, Escape, or **Close dialog** and verify the draft is intact and focus returns to **+**. Open the dialog again, save an objective and status, and reload to verify they persist.
5. Open the status picker and press Escape twice. The first press closes the picker, and the second closes Goal settings. Reopen Goal settings, edit status, and clear the goal. While a save or clear is pending, verify Close, Cancel, and Escape keep the dialog open. The returned server state is reflected on success. A failed save or clear keeps the editor open and displays an error.
6. Switch threads while a goal load/save is pending. The old response must not overwrite the new thread's panel. Emit a Goal update during a turn and verify that the status and usage update in the panel. Emit a Goal clear and verify that the summary disappears.
7. Repeat the visible flows in light and dark themes at 1280×900, 375×812, and 768×1024. Check that the chips and composer controls fit inside the viewport.
8. Save an active goal with a distinctive first line and enough lines to scroll in the objective field. Enable **+ → Plan mode** and **+ → Queue mode**. Verify that **Goal: active** sits on the same row as **Plan** and **Queue** in the normal and full-screen composer. Hover over the Goal chip and inspect its accessible name in DevTools. Verify the chip text and accessible name are both **Goal: active**, and that hovering never reveals the objective.
9. Click the chip or focus it and press Enter. In **Goal settings**, verify that the objective field receives focus, scroll to the last line, and edit and save the objective. Reopen settings to verify the edit. Close settings using Cancel, Escape, or **Close dialog** and verify focus returns to the chip in the current composer mode. Minimize the composer and repeat opening and closing settings from the remaining Goal chip. Verify that the composer stays minimized.
10. Complete the goal via the app server or select `complete` in Goal settings and save. Verify the chip reads **Goal: completed**. Repeat with the other statuses and verify **Goal: paused**, **Goal: blocked**, **Goal: usage limited**, and **Goal: budget limited**. Clear the goal and confirm the chip disappears. Confirm Goal… is absent in a new, uncreated conversation.
11. Inspect Goal requests. Opening or closing the menu or editor and completing a turn add no Goal reads. Opening a different thread or reconnecting loads the selected Goal. Switch threads while editing and confirm that the previous editor closes and late responses cannot restore it. For tab indicators, follow [Background conversations, Goals, and pending requests](../thread-loading-state/thread-titles-without-generation.md#background-conversations-goals-and-pending-requests).

## Automated Regression

After building, run `APPROVED_DIST_ROOT=. node scripts/test-composer-fullscreen.cjs` and `APPROVED_DIST_ROOT=. node scripts/test-composer-collapse.cjs` against `http://127.0.0.1:4173`. Set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Google Chrome. The fixtures cover the Goal labels, the Plan and Queue row, the full editable objective, and focus restoration in all three composer modes. The minimized test also simulates a browser that activates the chip without focusing it first. Screenshots and results are saved in `output/playwright/`.

## Performance Audit

The chip renders one status label from the selected Goal in memory. The settings form mounts only while the dialog is open. Playwright fixtures measured zero extra API requests from status notifications and opening or closing settings in both themes at 1280×900, 375×812, and 768×1024. Saving or clearing uses one Goal mutation each.

Opening a conversation or reconnecting reads one Goal for the selected conversation. The panel and tab indicators share that state and use the existing notification stream for changes. Goal events skip the conversation list and history refresh queue. Pending request events reuse the existing approval state and update the indicators locally. Browser fixture request counts confirmed zero additional API calls for Goal completion and pending request notifications in both themes. Turn outcomes retain their existing history synchronization and perform zero Goal reads. State is scoped to the selected conversation, turn correlation retains up to 64 entries, and stale reads are discarded after navigation or a newer event. The feature adds no polling, blocking I/O, or cross-thread fanout. Payload sizes are unchanged. Completion searches the installed skills locally, sorts matching skills, and renders at most 20 rows. Search cost is O(n log n) in the worst case for n matching skills.

## Rollback / Cleanup

Clear the temporary goal, disable Plan and Queue, remove temporary drafts and skill attachments, and restore the original theme.
