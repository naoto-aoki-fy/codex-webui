# Native workspace workflows

New conversations require an explicitly selected existing directory. Missing or nonexistent directories are rejected before forwarding thread/start; no fallback workspace is created. Existing folder browsing, registration, switching, CLI open-project, and managed Git worktrees remain available.

Conversation revert and fork/revert use Codex thread operations. The application never reverses patches, restores preimages, or resets files as part of these operations. Diff summaries and the diff viewer remain available.

The composer accepts ordinary files and images using the standard file input, clipboard, and file drag/drop paths. Camera capture and directory selection/upload are removed.

Project aliases and manual ordering controls, mutation APIs, timers, drag handlers, and browser persistence have been removed. Inactive legacy browser project-order and project-display-name keys are left intact without changing selected threads, drafts, registrations, files or history. They are not another writable project registry. Projects now use native IDs, names and positions; sidebar membership follows native thread associations. See [native Project migration](native-project-migration.md). Legacy global-state root arrays, labels, remote records and unknown fields remain intact as read-only migration input. Only an explicitly unsupported project/list permits read-only legacy display; it never restores legacy project writes.

Dedicated project/directory creation, GitHub clone, automatic chat-directory creation, and file rollback endpoints return JSON 404 for every method. Older tabs must reload. Existing directories under Documents/Codex remain accessible as historical conversations or through normal folder selection. Codex's own Git tools are unaffected.

## Performance

Removed file rollback paths performed full-history/session reads and patch processing followed by filesystem mutations; these requests now return a fixed 404 without RPC or file operations. New conversation validation performs one directory stat. Project sorting is O(n log n), without rename timers, mutation requests, or drag animation frames. No new fanout, large payloads, or cache invalidation paths were added.

A current-checkout startup profile measured one initial thread-list request, one skills request, zero duplicate thread reads, 196.6 KB total API data, and no warnings. Thread loading settled successfully. No before/after latency comparison or live Codex turn timing was measured.

## Verification

The unit suite covers native revert/fork sequencing without file restoration, removed endpoint rejection without data modification, missing workspace rejection, existing directory browsing, diff presentation, and attachment handling. The external-server fixture verifies built/development HTTP RPC, metadata, WebSocket transport, and retired APIs without credentials.

Browser checks cover existing folder selection in light/dark themes at desktop, phone, and tablet sizes, and ordinary text/image attachment rendering without submitting a turn. The startup profile and screenshots are under output/playwright. Real Codex conversation generation and destructive history actions were not exercised; fixture/mocked tests do not establish live-server acceptance.

See [manual workflow checks](../tests/projects-sidebar-new-chat/native-workspace-workflows.md).
