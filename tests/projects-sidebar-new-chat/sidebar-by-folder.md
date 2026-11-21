# Sidebar organization by folder

## Setup

Use a disposable App Server fixture or isolated test account. Prepare two native Projects with the same display name and root `/workspace/app`, plus an empty Project. Include one thread assigned to each of the two Projects and one with `projectId: null` and the same working directory. Give one thread a trailing separator in its fixture cwd. Also include threads in `/other/app`, `/workspace/日本語 + # & %`, `/workspace/app/.codex/worktrees/branch`, and a thread with an empty cwd. Pin one thread and prepare enough unpinned rows to span more than ten entries and a thread-list page.

## Actions and expected results

1. Open **Organize threads** and select **By project**. The two Projects are separate despite sharing a name and root. The empty Project is visible, and the thread without a Project is under **Unassigned**. Open a native Project menu and confirm **Remove** is available.
2. Select **By Folder**. The assigned and unassigned threads with equivalent `/workspace/app` working directories are together, with the pinned thread in **Pinned**. The two `app` folders show distinct visible paths and full-path tooltips. The worktree has its own group, the blank cwd is under **No working directory**, and there is no extra group for the empty Project.
3. Select a conversation and confirm its folder header and conversation row are highlighted. Collapse a folder, reload, and open a second tab. Verify the selected mode and collapse state persist and changes propagate between tabs. Switch to **Chronological list** and then **By project**. Verify the flat list and Project collapse state, then return to **By Folder**.
4. In **By Folder**, toggle **Updated** and **Created**, search for an existing thread and one on an unloaded page, and clear the search. Verify ordering, matching rows, continued page loading, and **Show more** / **Show less**. Pin and unpin a fixture thread. Archive and restore a fixture thread, then confirm it returns to the same folder.
5. Click a folder header or focus it and press Enter or Space. It toggles once with no navigation or added API request. Right-click the Japanese folder header and copy its address from the browser menu. Open that address, then repeat using Ctrl/Cmd+click, middle-click, the pencil, and **Open in new tab** from the three-dot menu. Verify the exact folder path survives reload, the URL carries only `cwd`, and **Remove** is absent. Repeat with **No working directory** and verify the composer opens with an empty folder selection.
6. In the isolated test environment, send a first message from the folder composer. Verify the new thread appears once in that folder before and after refresh. In a fresh composer, explicitly select a native Project from the dropdown and verify that the new thread appears in that Project in **By project**. Compare the original fixture threads' Project assignments before and after the mode switches.
7. Repeat the folder header, menu, and composer checks in both light and dark themes and in a narrow viewport. The duplicate folder names should remain distinguishable, and the composer should retain the intended folder after the mobile sidebar closes.

## Cleanup

Close the extra tab, restore the initial organization and theme preferences, and discard the isolated fixture or test data.
