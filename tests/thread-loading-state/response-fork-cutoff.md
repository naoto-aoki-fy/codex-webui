# Native fork and portable conversation transfer

Requirement: [CAP-002 Portable Fork](../../docs/product-requirements.md#cap-002-portable-fork).
Native Fork checks also protect the inclusive-cutoff distinction from CAP-001.

Prerequisites: connect an independently managed app-server supporting
`thread/inject_items`; configure two providers/models. Create a source with at
least 25 turns, text, a tool observation and an image. Stop any active turn.

1. Open the Fork arrow, choose Portable Fork and cancel its provider
   picker. Verify no new thread was created and the source draft is unchanged.
2. Choose Portable Fork again, select a destination provider and confirm. Double-click
   confirmation.
   Expect one `thread/start`, then one `thread/inject_items`, no native fork or
   `turn/start`. Check all ordinary messages, including unloaded older turns.
3. Click Load earlier messages and fork a response from that page. Verify the
   selected persisted turn ID is used for the inclusive cutoff. While the picker
   is open, append a source turn in
   another client. Confirm; expect only the captured prefix through the selected
   response. Transferred text must match the source without repeated import labels.
   Source attribution must remain in the internal transcript metadata.
4. Verify that only ordinary user/assistant text remains. Expect no tools, tool
   observations, reasoning, attachments, placeholders, or omission notices in
   the picker, injected items, or resulting conversation.
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
To use an installed Google Chrome, set `PLAYWRIGHT_CHANNEL=chrome`.

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
5. Choose Portable Fork from each dropdown. Expect only a provider picker,
   with no Native/Portable method selector. Cancel (also during preparation);
   expect no thread or turn and an unchanged source draft. Repeat with provider
   Q and the original provider P. Expect the existing start/inject lifecycle,
   natural message presentation, internal attribution and persistence after
   reload, no native fork request, and no duplicate injection on double clicks.
6. Simulate unsupported native forking. Expect an actionable error with no silent
   fallback. Explicitly choose Portable Fork and confirm; expect it to work
   independently. Reverse the test with portable preparation failure (for example
   the 8 MiB limit); cancel and click the main native action without a provider picker.
7. On an imported-only response, expect the main native button and Native Fork
   option to be disabled with a clear missing-turn-boundary explanation. The
   dropdown arrow and Portable Fork remain accessible and retain the prefix once.
8. Check the actual split buttons and open menus in light and dark themes.
   Confirm that both main/arrow controls are disabled while a fork is pending,
   and portable cancel/confirmation are disabled while injection is pending.
9. In light theme, start a turn that will stay active long enough to test. While
   it is running, click Fork on an earlier assistant response. Expect “Finish
   the current turn before forking from a response” with one visible × at the
   far right, named “Dismiss fork warning.” Click × and expect the warning and
   button to disappear immediately, with no API request caused by dismissal.
   Let the same turn continue, then click Fork on the earlier response again
   while the turn is still active. Expect the same warning and × to return.
10. Tab to the dismiss button and press Enter. Expect a visible focus indicator
    before pressing the key and immediate dismissal afterward. Switch to dark
    theme, trigger the warning again during an active turn, then Tab to × and
    press Space. Expect the icon and focus indicator to be visible in dark theme
    and both the warning and button to disappear. Repeat Space in light theme
    and Enter in dark theme.

Cleanup: stop the test turn if it is still running, and explicitly archive test
forks/imports, including incomplete destinations.
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
   internal attribution and duplicate-injection guards remain, without omission notices.
4. Repeat Native Fork and verify its text, provider and API workflow are unchanged.
   Inspect the actual destination conversation in light and dark themes.

Cleanup: archive the disposable destinations. No transcript migration or source
history rewrite is required; this change only affects message presentation.

## Provider defaults, scoped model lists and Skills-free Portable Fork

Setup: configure providers P and Q with different defaults. Include a model ID
shared by both providers, at least two models in Q, and an installed skill.
The mocked browser matrix (`node scripts/test-fork-methods.cjs`) uses P/A and
Q/C while also advertising Q/A, so accidental source-model inheritance fails.

1. Choose Portable Fork from each entry point. Expect a provider picker and no
   model picker. Confirmation stays disabled until a provider/default is valid.
   Select P then Q and confirm. Expect `thread/start` to receive Q and Q's
   default C, followed by the existing single `thread/inject_items` request.
2. Inspect the normal model picker before and after transfer. Expect only P
   models in the source and only Q models in the destination, with plain model
   names. Verify internal keys still distinguish shared model IDs by provider.
3. Choose another Q model and submit once. Expect that raw model ID and the
   existing destination provider; no re-fork or source model is retained. Repeat
   a server-confirmed provider change after a previous explicit model selection.
4. Open, cancel and reopen the portable dialog from both entry points. Expect
   no Skills toggle, panel or manager, no `/skills-hub` requests, and no
   `skills/config/write` calls from the dialog. Existing composer draft skill
   selections must remain intact. Open the main Skills Hub separately and verify
   its skill enable/disable controls and composer skill selection still work.
5. Reload the destination and repeat model selection. Check the provider-only
   dialog and model list in light and dark themes.
   Repeat Native Fork to confirm its API, provider, and direct action are unchanged.

Cleanup: restore any skill enable/disable changes made during this test and
archive disposable destinations. The dialog does not write provider defaults.

## Portable Fork initial provider selection (CAP-002)

Setup: use stopped disposable conversations on providers A and B. Configure A
as the global default, with different default models for A and B and at least one
non-default model in each provider. For credential-free coverage, start the
current dev server on 4173 and run `node scripts/test-fork-methods.cjs`.

1. With A selected in the composer, open Portable Fork from both the sidebar and
   a response. After history preparation, expect A to be selected for catalogs
   ordered `[A]`, `[A, B, C]` and `[C, A, B]`. Verify menu order is unchanged.
2. Open a conversation using B and choose a non-default B model in the composer.
   Open Portable Fork from both entry points. Expect B initially, despite A being
   the global default and the first catalog entry. Opening creates no destination
   or turn and changes neither global preferences nor the composer's selection.
3. Expect Create conversation to be enabled when the selected provider has a
   valid default model. With no available providers, confirmation stays disabled.
   If the composer's provider is unavailable, retain the existing fallback: first
   available non-source provider, then the first available provider.
4. Manually select another provider. Expect the choice to remain until the dialog
   closes, including after catalog updates. Confirm once; creation must use that
   provider's configured default model (or the existing declared-default/priority
   fallback), never inherit the composer's non-default model. History transfer,
   cutoff, persistence and failure handling must pass the earlier checks.
5. Manually switch provider, cancel and reopen from each entry point. Expect the
   composer's provider again, with its model and draft unchanged by cancellation.
   Repeat from a sidebar source different from the open conversation; use the
   current composer's provider, regardless of the sidebar source's provider.
6. Cancel during history preparation, open a new dialog, then let the old read
   finish. Expect no destination, generation or old selection applied to the new
   dialog. Each opening captures the composer provider at the time of opening.
   Verify the actual provider picker and selection in light and dark themes.

Cleanup: restore test provider configuration and archive disposable destinations.
No provider defaults are persisted by the dialog; cancel creates no destination.

Performance audit: preselection reads/parses the existing composer model key once
and scans the existing provider options (O(P)). It retains the original fallback
when that provider is unavailable and adds no RPCs, history reads, timers,
subscriptions or cache invalidation. Automated checks use mocked providers; live
inference latency is not measured.

## Ordinary text-only transfer

Setup: create a mixed-history source with user prompts, assistant replies,
Markdown/code blocks, command output, MCP/tool results, reasoning, images and
attachments. Include adjacent user messages and items containing no text.

1. Choose Portable Fork from the whole-conversation action, then from a selected
   response. Expect no omission notices or generated placeholders in the picker.
   In the Network panel, inspect `conversation-transfer/prepare` and
   `conversation-transfer/create`. Expect each result to omit `warnings`.
2. Inspect the injection request. Expect only user/assistant text messages in
   source order through the inclusive cutoff. No tool calls/results, observations,
   reasoning, provider state, images or unsupported items may appear. Expect no
   empty messages, rewritten text, merged messages, or generated annotation text.
3. Inspect the destination before and after reload. Expect the exact injected
   text and formatting, with no omitted-content labels, summaries or warnings.
   Transfer it again and expect its text prefix exactly once, without reinjection
   on ordinary resume. Internal attribution and import guards remain intact.
4. Repeat Native Fork. Expect its original native state, including historical
   tools, to remain intact. No native provider/model behavior changes.
5. Simulate an import failure or uncertain timeout. Expect the existing failure
   stage error and blocked continuation; genuine failures are still displayed.

Cleanup: archive disposable destinations. Existing completed transfers are not
rewritten or automatically reinjected. No workspace rollback is performed.

## Portable Fork and Revert (CAP-001 + CAP-002)

Prerequisites: use a stopped, persisted source with at least 25 turns and two
configured providers. Include multiline Markdown/code in a historical user message,
plus tools/images in earlier turns. Keep an unsent source composer draft with a
skill or attachment. Leave the oldest history unloaded. For mocked browser coverage,
run `PLAYWRIGHT_BROWSERS_PATH=<installed-browser-path> FORK_TEST_CASES=16,17 node scripts/test-fork-methods.cjs`
against the current worktree on port 4173. Server and desktop unit tests separately
cover full history, failure fencing, and draft writes.

1. Open the selected user message's Revert arrow. Expect separate Revert,
   Fork and Revert (Native), and Portable Fork and Revert options. Opening the
   menu must not prepare history or create anything. The main button must still
   run Native Fork and Revert. Repeat menu/dialog checks in light and dark themes.
2. Choose Portable Fork and Revert. Expect the existing provider picker with
   that title and only the destination provider control. Cancel, including while
   history is loading. Expect no destination, generation, source history/draft
   changes, or settings writes.
3. Open again, choose the other provider, and double-click Create conversation.
   Expect exactly one destination start and one history injection. Verify all
   eligible text before the selected user turn, including unloaded oldest turns,
   in order. Expect no selected prompt, its response, later history, tool output,
   reasoning or attachment placeholders in imported history. A source turn added
   after snapshot capture must not enter the destination.
4. Expect the selected prompt in the editable destination composer, matching its
   displayed multiline text/Markdown. There must be zero `turn/start` calls.
   Edit the draft, navigate to the source and back, then reload. Expect the edited
   draft to persist without resubmission, reset, or reinjection. Verify the entire
   source conversation and its original unsent draft/attachments/skills survive.
5. Explicitly submit the edited draft. Expect one new turn on the chosen provider
   and its default model. Model changes within that provider remain available.
6. Repeat on the first user message. Expect an empty imported transcript and the
   prompt as draft, one start, no injection and no generation. Repeat on a native
   user turn following an imported prefix; expect that prefix exactly once.
7. Simulate preparation failure, start acknowledgment loss, unsupported injection
   and injection acknowledgment loss. Expect an error, no native fallback or
   automatic retry, no source modification, and no restored draft in the source.
   Known incomplete destinations remain blocked from sending. A lost browser
   acknowledgment after a confirmed import may read the ready receipt and restore
   the destination draft without repeating creation/injection.
8. Remove/replace the selected turn or user item before snapshot capture. Expect
   a stale-target error before creation. Active turns remain ineligible. Check
   ordinary Portable Fork response cutoffs are still inclusive and both native
   Revert actions retain their existing behavior.

Cleanup: archive disposable complete/incomplete destinations explicitly; clear
only disposable destination drafts. Do not repeat ambiguous mutations. No files
are reverted. Record real app-server version/provider results separately from
mocked browser and fixture results.
