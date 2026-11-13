# Native fork and portable conversation transfer

Prerequisites: connect an independently managed app-server supporting
`thread/inject_items`; configure two providers/models. Create a source with at
least 25 turns, text, a tool observation and an image. Stop any active turn.

1. Open the Fork arrow, choose Portable Fork and cancel its provider/model
   picker. Verify no new thread was created and the source draft is unchanged.
2. Choose Portable Fork again, select a destination and confirm. Double-click
   confirmation.
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
   Fork toolbar. Check that the main Fork action and adjacent arrow match the
   Revert split-button pattern. Click the arrow; expect Native Fork and Portable
   Fork options, without history preparation, thread creation or generation.
2. Click the main Fork button, then repeat with the Native Fork menu option.
   Expect immediate native creation without a method or provider dialog. Double
   clicks must create once. Expect no portable preparation, `thread/start`,
   `thread/inject_items`, automatic generation, or provider switching.
3. For a response fork expect exactly the inclusive response prefix, even after
   later source turns. If the selected source turn was removed/replaced before
   creation, expect an explicit stale-cutoff error and no fork.
4. Reload/reopen each native destination. Expect server-rendered history without
   imported-context labels or import-incomplete guards. The source provider
   remains selected. Try choosing another provider in the composer; expect a
   Portable Transfer instruction, never an automatic re-fork. Explicitly submit
   one new message; expect exactly one turn on the source provider.
5. Choose Portable Fork from each dropdown. Expect only a provider/model picker,
   with no Native/Portable method selector. Cancel (also during preparation);
   expect no thread or turn and an unchanged source draft. Repeat with provider
   Q and the original provider P. Expect the existing start/inject lifecycle,
   natural message presentation, internal attribution and persistence after
   reload, no native fork request, and no duplicate injection on double clicks.
6. Simulate unsupported native forking. Expect an actionable error with no silent
   fallback. Explicitly choose Portable Fork and confirm; expect it to work
   independently. Reverse the test with portable preparation failure (for example
   the 8 MiB limit); cancel and click the main native action without a model picker.
7. On an imported-only response, expect the main native button and Native Fork
   option to be disabled with a clear missing-turn-boundary explanation. The
   dropdown arrow and Portable Fork remain accessible and retain the prefix once.
8. Check the actual split buttons and open menus in light and dark themes.
   Confirm that both main/arrow controls are disabled while a fork is pending,
   and portable cancel/confirmation are disabled while injection is pending.

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
