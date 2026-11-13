# Portable conversation transfer

Prerequisites: connect an independently managed app-server supporting
`thread/inject_items`; configure two providers/models. Create a source with at
least 25 turns, text, a tool observation and an image. Stop any active turn.

1. Invoke Fork conversation. Cancel the provider/model picker. Verify no new
   thread was created and the source draft remains unchanged.
2. Reopen the picker, select a destination and confirm. Double-click confirmation.
   Expect one `thread/start`, then one `thread/inject_items`, no native fork or
   `turn/start`. Check all ordinary messages, including unloaded older turns.
3. Fork a middle response. While the picker is open, append a source turn in
   another client. Confirm; expect only the captured prefix through the selected
   response. Imported text must match the source and show source attribution.
4. Verify omission warnings, attachment placeholders and labeled tool observations.
   Expect no executable historical tools, reasoning, or privileged instructions.
5. Reload/reopen the destination. Verify visible imported history remains and no
   reinjection occurs. Explicitly ask about the earliest source text. Expect one
   new turn on the selected provider/model with the imported context available.
6. Transfer the imported thread again, including from an imported response.
   Expect the original imported prefix exactly once and the requested cutoff.
7. Disconnect during injection, then reconnect/reload. Expect an incomplete
   destination error identifying its stage; sending must be blocked and injection
   must not replay. Verify the original source and draft remain intact.
8. Repeat RiVault → OpenAI and OpenAI → RiVault, in light and dark themes. Record
   connected Codex version, destination identity and actual continuation results.
   Distinguish unsupported destination runtime requests from migration failures.

Cleanup: explicitly archive disposable destinations, including incomplete ones.
No workspace rollback occurs. Do not retry an ambiguous injection manually.

Mocked coverage: `src/server/conversationTransfer.test.ts` and desktop state tests.
Native cutoff tests remain relevant to edit/retry/revert helpers, not these two
transfer workflows. Live provider checks require credentials and a real server.
