# Projects and Threads heading and Pinned expansion

Setup: Open the app in a test browser profile with a project containing an unpinned thread and a separate pinned thread. Set `codex-web-local.sidebar-section-expansion.v1` to `{"projects":false,"pinned":true}` and `codex-web-local.sidebar-section-expansion.v2.projects` to the JSON string `"0"` in local storage to simulate saved collapse preferences.

1. Select By project in Organize and reload. Expect the **Projects** heading and the project folders to be visible. Check that the heading starts at the row's left padding and Organize sits at the right edge. Click the heading and verify that it has no chevron and the folders stay visible.
2. Collapse and expand the individual project folder. Expect its thread rows to hide and return.
3. Select Chronological list in Organize. Expect the heading to change immediately to **Threads** at the same left alignment, Organize to stay right-aligned, and the unpinned thread to appear in the list. Click the heading and reload. Expect **Threads** and the list to remain visible.
4. Switch back to By project without reloading. Expect **Projects** immediately. Collapse Pinned and reload. Expect Pinned to remain collapsed and project folders to be visible. Expand Pinned and verify its thread returns.
5. Collapse and reopen the whole sidebar. Search for the unpinned thread and select it. Expect the sidebar controls, search results, and navigation to work. Repeat in light and dark themes at desktop and mobile widths.

Cleanup: Discard the test profile or restore the original storage values, view mode, and folder and Pinned expansion choices. For legacy history and folder checks, see [explicit folders](remove-projectless-chats.md).

## Native project order and thread timestamp sorting

Use a disposable App Server with project order `[Alpha, Empty, Zulu]`,
multiple threads with different creation and update times, and two pinned threads.
Leave Empty without threads.

1. In Projects → Organize → By project, switch between Updated and Created.
   Expect both modes to keep the native project order and sort member threads
   by the selected timestamp. Equal timestamps use thread ID order.
2. Switch to Chronological list and verify global sorting follows the selected timestamp.
3. Send a test message and load additional thread pages. Expect recalculated thread
   order without changes to project positions. Verify Pinned order stays independent.
4. Select Move up in Zulu's project menu. Reload and confirm the server's updated
   project order is visible. Repeat menu and list checks in light and dark themes.

Restore the original project positions, sort/view preferences, and pin order.
Archive or remove only disposable test records.
