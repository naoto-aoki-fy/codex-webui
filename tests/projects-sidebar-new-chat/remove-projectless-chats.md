# Explicit folders for new conversations

Setup: Run the app against an authenticated external Codex server. Keep an existing project, a pinned thread, and a legacy Documents/Codex dated chat with a direct thread URL. Record the legacy directory and session contents before testing.

1. Open Home without a cwd query or folder selection. Submit a prompt. Expect a message asking for an existing workspace, no thread/start RPC, and no new directory or session. Repeat with the worktree runtime selected.
2. Select an existing folder and submit. Expect a conversation in that folder; send another message and refresh to confirm history and selection persist. Select an existing worktree directory; expect it to be used directly without creation.
3. Inspect the sidebar and its organize menu in project and chronological modes. Expect Projects and Pinned, with no Chats section, Chats first option, dedicated chat creation, or chat expansion controls. Legacy projectless chats must not be added to Projects.
4. Navigate project and pinned threads, then open the saved legacy direct URL. Expect existing history and normal continuation. Compare legacy session and directory contents; no automatic deletion or migration should occur.
5. Repeat sidebar navigation at desktop, 375x812, and 768x1024 in light and dark themes. Expect usable navigation and consistent surfaces.

Cleanup: Remove only conversations or worktrees explicitly created for this test using normal user controls. Preserve legacy data.
