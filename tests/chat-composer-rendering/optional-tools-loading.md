# Optional tools load on demand

Current access and layout/state checks: [management dialogs and send modes](../chat-composer-rendering/management-dialogs-send-modes.md). Detailed tools use the conversation header menu; composer selection uses +; account and connection management use Settings.


Setup: fresh browser context and the built production fixture. Open a conversation.
Only compact header/composer entry points should appear. Their
optional UI chunks must not be fetched
at startup. Open each header/composer entry or Settings explicitly: its actual controls must
load. Open Conversation actions and Background processes explicitly within
Conversation tools. Verify that opening the dialogs alone sends no mutation. Close/reopen and navigate threads: no
duplicate subscription; existing controller state/drafts persist as before. Verify
light/dark at all three standard sizes. Cleanup: close fixture context; no native
resources are changed.

Performance audit: uses existing Vue async-component boundaries and explicit first-
open mounting, not a new state/capability owner. Removes optional panel code from
startup, retaining existing history/notification ownership. Production comparison
asserts no ConversationTools/AppsPicker chunk
request before opening; startup API counts and native response bytes must match
pre-pass fixtures. Lazy body objects are invalidated by existing connection epochs.

## Removed WebUI tools and retained controls

Setup: a disposable fixture conversation with older history, a known file-change
event, and an existing Git worktree on the App Server.

1. Open the composer + menu. Goal, Plan mode and Apps / Connectors remain
   available. The prompt library entry is absent.
2. Open the conversation header and sidebar thread menus. Copy conversation /
   Copy chat is available, and neither menu offers a Markdown download. Copy the
   visible chat, then scroll up to load older history. Only scrolling requests
   older pages.
3. Open Conversation tools. Native review, manual compaction and Background
   processes remain available. The Git status and worktree creation panels are
   absent. Inspect the conversation's file-change event and confirm its patch
   still opens.
4. Open the existing worktree from folder selection and reload. Its path and
   conversation history remain available. Repeat the menu checks in light and
   dark themes at desktop, 375×812 and 768×1024.

Cleanup: close the fixture pages. Keep the existing worktree and browser data.
