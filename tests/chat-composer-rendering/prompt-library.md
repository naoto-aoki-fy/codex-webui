# Text presets, prompt history and command discovery (25)

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
fixture browser; no remote preset registry or deferred queue exists.

Performance: no RPC/subscription/startup reads. Profile-local storage is read on
opening the library and on accepted text submission; at most 20 presets/30 prompts,
450,000 serialized characters accepted on load. Bounded synchronous storage and
JSON processing, no attachment/conversation copies. Browser matrix verifies no
turn on selection or action alias, reload persistence and explicit clearing.
Live model acceptance NOT RUN (fixture protocol only).

While the main draft contains text, focus Preset name and press Enter. It must
neither submit the chat nor alter its draft. Use Save text preset explicitly.
IME composition confirmation in the name input is not intercepted.
