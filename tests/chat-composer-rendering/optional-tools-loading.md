# Optional tools load on demand

Current access and layout/state checks: [management dialogs and send modes](../chat-composer-rendering/management-dialogs-send-modes.md). Detailed tools use the conversation header menu; composer selection uses +; account and connection management use Settings.


Setup: fresh browser context and the built production fixture. Open a conversation.
Only compact header/composer entry points should appear. Their
optional UI chunks, the prompt library, and Remote Control view must not be fetched
at startup. Open each header/composer entry or Settings explicitly: its actual controls must
load, but native reads still require the read/refresh buttons. /review, /compact,
/diff and /processes must open the lazy tools group and the corresponding panel
without sending or performing a mutation. Close/reopen and navigate threads: no
duplicate subscription; existing controller state/drafts persist as before. Verify
light/dark at all three standard sizes. Cleanup: close fixture context; no native
resources are changed.

Performance audit: uses existing Vue async-component boundaries and explicit first-
open mounting, not a new state/capability owner. Removes optional panel code from
startup, retaining existing history/notification ownership. Production comparison
asserts no ConversationTools/AppsPicker/PromptLibrary/RemoteControlStatus chunk
request before opening; startup API counts and native response bytes must match
pre-pass fixtures. Lazy body objects are invalidated by existing connection epochs.
