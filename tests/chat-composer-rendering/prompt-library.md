# Text presets, prompt history and command discovery (25)

Current access and layout/state checks: [management dialogs and send modes](../chat-composer-rendering/management-dialogs-send-modes.md). Detailed tools use the conversation header menu; composer selection uses +; account and connection management use Settings.


Setup: ordinary conversation or isolated `node scripts/test-approved-prompts.cjs`.
Open Prompts & commands. Save a named preset, edit it, reload, select it: draft
text changes, attachments/skills remain, no turn is sent. Delete individual presets
and history rows; clear recent history or all stored text explicitly. Submit a
normal prompt: only accepted text enters recent history (30 entries, deduplicated,
8,000 characters each). Rejected prompts, attachment bytes and tool output must
not be stored. Obvious credential-like/oversized text is submitted without history.
Storage failures show a message without blocking submission.
Type /help, /prompts, /presets, /history: opens this editor. /review, /compact,
/diff, /processes open the existing conversation controls without executing them.
Unknown slash input is sent normally. Existing Goal/Plan, skill selection (including
a skill named review), Enter/Shift-Enter/IME, drafts and immediate steering remain.
Both themes/all three sizes. Cleanup: Clear all stored prompts and presets in the
fixture browser; no remote preset registry or browser-owned execution queue exists.

Performance: no RPC/subscription/startup reads. Profile-local storage is read on
opening the library and on accepted text submission; at most 20 presets/30 prompts,
450,000 serialized characters accepted on load. Bounded synchronous storage and
JSON processing, no attachment/conversation copies. Browser matrix verifies no
turn on selection or action alias, reload persistence and explicit clearing.
Live model acceptance NOT RUN (fixture protocol only).

While the main draft contains text, focus Preset name and press Enter. It must
neither submit the chat nor alter its draft. Use Save text preset explicitly.
IME composition confirmation in the name input is not intercepted.

## Opt-in history and concurrent presets

Setup: Two tabs in one profile. Seed an existing `prompt-library.v1` with a preset
and history entry, but no `prompt-history-enabled.v1` setting.

1. Open Prompts & commands in both tabs. Existing preset/history must remain;
   recording must be disabled. Submit harmless text: it must not be recorded.
2. Click **Enable recent prompt history**. Accept a prompt, reopen the library:
   text appears once. Credential-like and >8,000-character text must not be saved.
3. Create distinct presets concurrently in both tabs. Both must appear, including
   after reload. Edit/delete different presets concurrently: neither action may
   undo the other's change. Open dialogs update through storage events.
4. Clear recent history in one tab while saving a preset in the other. Presets
   must survive. Disabling recording must retain existing history for explicit
   clearing. The bounds remain 20 presets and 30 history entries.
5. Repeat with Web Locks disabled (the same IndexedDB transaction path), then with all browser
   persistence denied: errors must be visible and submission must still work.
6. Repeat in light/dark themes and at 375x812 and 768x1024. Selecting a preset
   changes only the current tab's editable text and never submits automatically.

Cleanup: Clear disposable history/presets explicitly; restore fixtures and opt-in
setting. Never clear all localStorage as part of migration or recovery.
