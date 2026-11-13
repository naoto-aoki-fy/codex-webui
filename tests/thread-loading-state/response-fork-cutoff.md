# Native fork and portable conversation transfer

Prerequisites: connect an independently managed app-server supporting
`thread/inject_items`; configure two providers/models. Create a source with at
least 25 turns, text, a tool observation and an image. Stop any active turn.

1. Invoke Fork conversation. Verify Portable Transfer is selected by default. Cancel the picker. Verify no new
   thread was created and the source draft remains unchanged.
2. Reopen the picker, keep Portable Transfer selected, select a destination and confirm. Double-click confirmation.
   Expect one `thread/start`, then one `thread/inject_items`, no native fork or
   `turn/start`. Check all ordinary messages, including unloaded older turns.
3. Fork a middle response. While the picker is open, append a source turn in
   another client. Confirm; expect only the captured prefix through the selected
   response. Transferred text must match the source without repeated import labels.
   Source attribution must remain in the internal transcript metadata.
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
Native cutoff tests cover Native Fork response cutoffs as well as the existing
native helpers. Live provider checks require credentials and a real server.

## Fork method selection

Setup: use the source from above with a stopped turn, configured providers P and
Q, and an app-server supporting native `thread/fork` and inclusive `lastTurnId`.
For credential-free browser checks, start the current dev server on port 4173
and run `node scripts/test-fork-methods.cjs` with an installed Playwright browser.

1. Open both the sidebar whole-conversation action and an assistant response's
   Fork action. In each picker verify both method options exist, Portable
   Transfer is the default, and switching to Native Fork hides provider/model
   selection and explains that the provider remains the same.
2. Cancel each method from both entry points. Expect no destination or turn
   creation and no change to the source's unsent draft. Repeat cancellation
   while portable preparation is still pending; expect no stale dialog/error.
3. Confirm Native Fork with a double click. Expect one native fork API request,
   no `thread/start`, `thread/inject_items`, or automatic generation. For a response
   expect exactly the inclusive response prefix, even after later source turns.
   If the selected source turn was removed/replaced while the picker was open,
   expect an explicit stale-cutoff error and no fork.
4. Reload/reopen each native destination. Expect server-rendered history without
   imported-context labels or import-incomplete guards. The source provider
   remains selected. Try choosing another provider in the composer; expect a
   Portable Transfer instruction, never an automatic re-fork. Explicitly submit
   one new message; expect exactly one turn on the source provider.
5. Repeat Portable Transfer for both entry points with provider Q and with the
   original provider P. Expect the existing start/inject lifecycle, natural
   message presentation and preserved internal attribution after reload, and no
   native fork request. The original transfer cases above, including omissions
   and uncertain injection, still apply.
6. Simulate an unsupported native fork. Expect an actionable Native Fork error,
   no silent transfer fallback, and the source/draft intact. Explicitly switch
   to Portable Transfer and confirm; expect it to work independently. Reverse
   the test with a portable preparation error (for example the 8 MiB limit);
   expect Native Fork to remain available without a destination model selection.
7. Open Fork on an imported-only response. Expect Portable Transfer to retain
   that prefix exactly once. Native Fork explains the missing native turn boundary
   and cannot be confirmed for that response.
8. Check the actual picker in light and dark themes and verify method selection,
   cancel, and confirmation are disabled while creation is pending.

Cleanup: explicitly archive test forks/imports, including incomplete destinations.
No workspace rollback occurs; never replay an injection with an uncertain outcome.

## Portable transcript presentation

Setup: use the source above with user/assistant text, Markdown, code blocks and
line breaks. Also include user-authored text beginning with “Imported:” to
verify original text is never stripped. Run the mocked browser matrix with
`node scripts/test-fork-methods.cjs` for credential-free UI coverage.

1. Create a Portable Transfer and inspect the resulting conversation. Expect
   original message roles, order, text and formatting, without any generated
   “Imported” prefixes or repeated source labels on user or assistant messages.
2. Reload and reopen the destination. Expect the same natural display and
   original user-authored “Imported:” text. Read/resume responses should still
   contain `importedTranscript` source attribution and a ready import stage.
   Expect no reinjection or regenerated historical response.
3. Transfer that conversation again. Expect the imported prefix exactly once;
   internal attribution, omission warnings and duplicate-injection guards remain.
4. Repeat Native Fork and verify its text, provider and API workflow are unchanged.
   Inspect the actual destination conversation in light and dark themes.

Cleanup: archive the disposable destinations. No transcript migration or source
history rewrite is required; this change only affects message presentation.
