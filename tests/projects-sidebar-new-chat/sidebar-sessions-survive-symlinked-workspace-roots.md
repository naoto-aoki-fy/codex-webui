# Sidebar sessions with symlinked workspace roots

Use a disposable directory and symlink on the App Server host. Create a native
Project through the folder picker using the symlink path. Start one conversation
through the Project and create another native conversation with the target cwd,
leaving that conversation unassigned.

1. Reload the WebUI and inspect the Projects sidebar in light and dark themes.
2. Search for both conversation titles and reopen them by their sidebar rows.
3. Inspect `project/list` through the RPC transport. Compare the displayed project
   name and selected root with the native response. Both conversations retain the
   membership returned by the App Server, even if their cwd representations differ.
4. Switch to the folder view. Check that both conversations are available in the
   groups derived from their recorded cwd values.

Remove only the test project and test conversations, remove the test symlink and
directory, and restore the original theme.
