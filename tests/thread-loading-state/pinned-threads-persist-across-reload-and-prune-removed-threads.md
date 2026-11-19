# Native thread pins and names

Use a disposable profile on an App Server with native thread sections. Create
two threads, then record a legacy pin and an unrelated value in the disposable
WebUI global-state file.

1. Pin a thread and rename it. Reload and reconnect. The new pin and name persist.
2. Move the thread to a different section in another client and observe the WebUI
   refresh. Unpinning sends `thread/section/move` with a null section ID.
3. Repeat in both themes. Native pin membership and the thread name remain visible.
4. Deny the native list request. The sidebar surfaces the error and keeps its last
   successful pins. Check that the legacy key and unrelated value stay unchanged.

Cleanup: restore the original section/name for the disposable threads and discard
the disposable profile.

The pin list reads native section pages serially at 100 rows per request.
