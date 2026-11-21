# Sidebar search targets

## Setup

Connect an independently managed Codex App Server with experimental
`thread/search` enabled. Use the same account and CODEX_HOME as the app. Have
more threads than one list page, including older threads with known titles and
working directories. Register two Projects with the same name and root path,
one Project with a different root but the same name, and a Project without
threads. Include working directories with the same final folder name under
different parents, a long path, and a term found exclusively in a parent folder.
Use a unique phrase in a persisted user or assistant message and include Japanese
text in message bodies, thread titles, and folder names.

Open the browser's Network panel and filter for `/codex-api/rpc`. Use the
**Thread Name** and **Folder** steps immediately after initial list load, before
background pagination completes. The browser fixture below provides deterministic
pending responses, paging, and failures.

## Actions and expected results

1. Open the magnifying glass. The input receives focus and **Messages** is
   selected. Enter the message-only phrase. Expect a single list of matching
   threads, including results from older pages. Repeat with Japanese text.
   `thread/search` starts after 200 ms of inactivity and requests pages of 100 in
   descending updated order. Each page becomes visible while the next loads.
2. Switch to **Thread Name**. The input retains its text and matches displayed
   titles, ignoring case. Check that exact matches precede prefix matches, which
   precede partial matches. Within each rank, the most recently updated thread
   comes first. Search for the title of an older thread and wait for it to appear.
   Use its actions menu and open the thread. Confirm the conversation and
   `#/thread/<id>` destination.
3. Select **Project**. Search for the Project without threads and open it. The
   new Thread screen uses its resolved working directory, with `projectId`
   and `cwd` in the route when the Project has a working path. Projects with the
   same name and display path show their IDs. With different paths, those paths
   distinguish the Projects. Other results of the same rank sort by name.
4. Select **Folder**. Find a folder from a registered root and one from an older
   thread's working directory. Confirm that the same normalized full path
   appears once, folders with the same leaf name show full paths beneath the
   name, and a query found only in a parent folder yields **No results found**.
   Open an older folder result and confirm the new Thread screen uses the
   selected path. The route contains only `cwd`.
5. Start a response before searching for an older title or folder. Confirm loaded
   matches remain visible and the sidebar displays **Waiting for responses to
   finish…**. Once generation finishes, the shared list continues one page at a
   time. Simulate a failed page and confirm existing results remain, with a
   **Retry** button. Retry and confirm paging resumes from the failed cursor.
   If a refresh of the first page fails before paging can start, Retry fetches
   the first page again and continues with its new cursor.
   An empty result set shows **No results found** once discovery finishes.
6. With a message request pending, change the query, switch to another target,
   and press **Esc**. Confirm late responses never appear or request a follow-up
   page. Try Messages with an unsupported server and a simulated connection
   failure. Confirm the search results area identifies the error.
7. Repeat with the sidebar organized by Project, Folder, and Chronological list.
   Each search displays a single list. Clear the input and confirm the normal
   sidebar and previous target remain. Use Tab and Space to switch targets,
   Enter to open a result, and Esc to close search and focus the magnifying glass.
   Reopen and confirm **Messages** is selected.
8. Repeat in light and dark themes at desktop, 768×1024, and 375×812. Check the
   selected button, error and waiting text, and long path wrapping. On mobile,
   selecting a result closes the drawer.
9. Filter the captured requests by method. Already-loaded title, project, and
   folder searches cause zero additional RPCs. For unread thread list portions,
   there is one `thread/list` request per cursor, with one extra request only
   for an explicitly retried failure. Search does not issue `thread/read`,
   `thread/resume`, or `thread/turns/list` for an unopened result. After opening
   a thread, ordinary conversation loading can issue those requests.

## Fixture and cleanup

Run `node scripts/test-sidebar-search.cjs` with Playwright Chromium installed
and the current checkout running at `http://127.0.0.1:4173`. It tests search
through the browser, intercepts slow and failed requests, and saves screenshots
and request counts under `output/playwright/`.

Close the search and restore any sidebar or theme preferences changed for the
test. Archive disposable threads and unregister disposable Projects through the
ordinary controls. Restore the original external server after compatibility
tests.
