# Expandable Projects and Pinned sections

Setup: Open the app with an existing project and a pinned thread.

1. Expand and collapse Projects and Pinned independently. Expect their rows to hide and return.
2. Refresh. Expect both expansion choices to persist.
3. Switch project and chronological layouts in the organize menu. Expect project thread navigation to work and no Chats controls.
4. Repeat in light and dark themes at desktop and mobile widths.

Cleanup: Restore the original expansion choices. For legacy history and folder checks, see [explicit folders](remove-projectless-chats.md).

## Project and chronological timestamp sorting

Prerequisites: connect an app-server with two projects (Alpha and Zulu), multiple threads with differing server `createdAt` and `updatedAt`, an empty workspace, and two pinned threads. Ensure Zulu contains the most recently updated thread and Alpha the most recently created thread.

1. Open Projects → Organize → By project → Updated. Expect Zulu first and its threads ordered by update time descending. Empty projects appear last. Equal timestamps use project name, or thread ID within a project, ascending.
2. Select Created. Expect Alpha first and threads ordered by creation time descending. Select Chronological list and verify the same selected timestamp determines the global order.
3. Switch back to Updated, send a message in Alpha, and wait for server metadata refresh. Expect Alpha to move first when its server update time becomes newest. Load additional thread pages and verify newly loaded threads are inserted according to the selected timestamp.
4. Verify pinned thread order is unchanged in both modes, pinned rows stay excluded from project/global rows, and dated-directory conversations appear as ordinary project conversations. Search, select a thread, and collapse/expand a project; verify these actions still work.
5. Refresh after selecting Created and verify the preference persists. Repeat menu and list checks in light and dark themes.

Cleanup: restore the original sort/view preferences and pin order; archive any test threads created for this check.

Implementation notes: `thread/list` requests server `updated_at` pages; `normalizeThreadGroupsV2` converts server `createdAt`/`updatedAt` to ISO fields. Desktop state merges pages and refreshed metadata. Sidebar sorting derives project maxima and thread order reactively from those fields, before search and pin filtering; a pinned thread still contributes to its project's activity. No filesystem or Git timestamps are consulted.

Performance audit: the sidebar computed value copies and sorts each project's threads and then projects (O(sum(n log n) + p log p), O(n + p) additional references). It is cached until groups or sort preference change. Global sorting uses the same comparator. The change adds no requests, blocking I/O, payload growth, or asynchronous fanout. Live browser timing was not measured.
