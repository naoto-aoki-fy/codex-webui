# Native thread pins and names

Setup: Codex 0.167.2 app-server, two existing threads, and a disposable web CODEX_HOME with legacy pinned-thread-ids and an unrelated global-state field.

Actions: load sidebar, pin/unpin a thread, rename a thread, reload, reconnect, and change its section from another client. Repeat in light and dark themes. Repeat migration with an unsupported server or a failed move.

Expected: pins use the built-in native Pinned section and names use thread/name/set. State survives reload and reconnect. Successful migration removes only pinned-thread-ids; interrupted migration retains the field for retry. No title-cache requests or writes occur. Unsupported sections leave legacy state intact.

Cleanup: restore original section/name using native controls; preserve original user files.

Performance: removed title-cache startup request and pin-array write watcher/pruning. Section reads paginate serially in pages of 100; migration moves only legacy IDs, then stops. No live timings measured.
