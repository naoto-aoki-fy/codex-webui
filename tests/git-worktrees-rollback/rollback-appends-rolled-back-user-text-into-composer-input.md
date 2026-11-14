### Feature: Revert and Fork and Revert restore the selected prompt for editing

Prerequisites: a disposable persisted paginated thread with three completed turns,
known second prompt, and a visible composer. Use an independently managed test
App Server; run in both light and dark themes.

Actions and expected results:
1. Choose Fork and Revert on the second user message. Wait for completion. The
   destination has only the first turn, the source still has three turns, the
   route and selected conversation both point to the destination, and its composer
   contains the exact second prompt for editing. No inference is started.
2. Reload the destination. The prompt survives as an ordinary composer draft.
   There is no fresh-fork registry or separate recovery state machine.
3. Test ordinary Revert on another disposable conversation. It removes the chosen
   turn and later history, then appends the prompt to any existing composer text.
4. Deliver a materialization/index-invalidation notification during validation or
   the post-revert history refresh. That specific read race may retry once;
   fork, revert and turn/start mutations must never be replayed. A repeated read
   failure or unrelated permission error remains visible with destination details.
5. Navigate elsewhere while the operation runs. It must not overwrite the other
   conversation's draft or steal its route when the operation finishes.

Cleanup: archive only test conversations and clear unwanted test drafts. Restore
original theme. No workspace files or original source rollout files are restored
or edited by this operation.
