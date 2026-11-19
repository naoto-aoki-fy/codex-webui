# Concurrent native project updates

Use two browser tabs connected to the same disposable App Server. Create three
existing directories, including two with identical basenames. Register all three.
Keep a disposable conversation and file in one project.

1. In tab A, delay a native `project/list` response with interception. In tab B,
   rename and move one project, then remove a different project.
2. Release the response in A. Reload both tabs. Confirm both show the native names
   and order and only the selected project ID was removed.
3. Delay a background `thread/list` page during removal. Confirm the affected
   conversation remains visible and reopens after reload. It should be unassigned
   once the server's updated thread record is loaded. Verify the file is intact.
4. Fail a `project/list` request and check for an actionable error while the last
   displayed project list remains available. Restore the connection and use
   Reconnect. Confirm the list refreshes.
5. Repeat with both themes. Inspect the Network log. Startup requests one first
   project page, subsequent pages use its cursor, and opening or focusing the tab
   does not run a separate project refresh.

Restore the original theme and remove only the disposable projects and files.
