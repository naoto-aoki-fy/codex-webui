# Conversation diff viewer extraction

## Setup

Run `pnpm run dev --host 127.0.0.1 --port 4173` with an external app-server available. Open a thread with a completed file-change summary containing multiple files, a renamed file, and a patch with context, additions, and removals. Also use a restored summary without patch content.

## Actions and expected results

1. On desktop, click a file path in the summary. The viewer opens with the selected file, operation badge, delta, language, and changed-file sidebar. Context, added, and removed lines retain their markers and old/new line numbers; HTML-looking text displays literally.
2. Select another sidebar file, including a renamed file. The active highlight, header, and patch update together. A missing patch shows “No diff available”. No separate loading/error state is expected: this viewer reads existing summary data.
3. Close using the labeled close button, then reopen and close by clicking outside the shell. Clicking inside the viewer does not close it. Buttons remain keyboard focusable and activate with Enter/Space.
4. Repeat at 375x812 and 768x1024. On the phone, use the file-count button to open the bottom sheet. Selecting a file closes the sheet; tapping its backdrop closes only the sheet. Long patches scroll inside the patch panel.
5. Repeat in light and dark themes. Check badges, toolbar, close button, sheet, line colors, and overflow against the previous viewer.
6. Open the viewer and switch threads, including rapid A → B → A switches. The old viewer stays dismissed. Unmount the conversation while open; no viewer remains.
Conversation revert uses native Codex history operations and never restores local files. File diffs remain inspectable; file Undo/Redo has been removed.

## Cleanup

Conversation revert uses native Codex history operations and never restores local files. File diffs remain inspectable; file Undo/Redo has been removed.

## Automated coverage

Conversation revert uses native Codex history operations and never restores local files. File diffs remain inspectable; file Undo/Redo has been removed.
