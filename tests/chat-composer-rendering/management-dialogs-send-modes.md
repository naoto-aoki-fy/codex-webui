# Management dialogs and composer send modes

Setup: build the current source with `pnpm run build`. Run
`APPROVED_DIST_ROOT=. PLAYWRIGHT_BROWSERS_PATH=<installed-browser-directory> node scripts/test-management-layout.cjs`
for credential-free intercepted production assets at
`http://127.0.0.1:4173/#/thread/approved-fixture`. This does not test live Codex
credentials, service activation, or real destructive actions. For manual testing,
use a disposable native conversation and a supported independently managed server.

## Layout, access, focus and state continuity

1. At 1280×900, 768×1024, 375×812 and 320×900, inspect light and dark themes.
   Expand an MCP execution result. Its outer column must match assistant messages;
   output remains left aligned, with code/log scrolling local to its output.
2. Enter a draft, turn on **Queue mode** in **+**, and leave the chat at
   a known scroll position. Open **sidebar → Settings → Archived conversations**. Read a long
   title, inspect its full text/title tooltip, refresh, and exercise loading,
   empty and read-error states. Restore remains distinct from permanent deletion.
   No permanent-delete capability is added to archive rows.
3. Open **sidebar → Settings**. Use General, Codex account, and Apps / Connectors
   categories. Confirm the native account status appears and MCP status loads.
   Opening any category must not log in/out, change connections or reload/write MCP
   configuration. Confirm the Remote Control panel is absent.
4. Open **conversation header … → Conversation tools…**. The header contains only
   **Conversation tools** and its close button, with no conversation title, native
   ID, or description. Verify permissions, queue, subagents and background
   processes remain. Hooks, advanced configuration, Daybreak, standalone commands,
   memory inspection and external-agent import preview are absent. Close with
   Escape, then open **conversation header … → Context**: its header contains only
   **Context** and its close button. Verify context usage content still renders
   when available. Close with the close button; focus returns to the header menu.
   The conversation title remains in the page header and sidebar. Change
   conversation via routing while either dialog is open: it closes before controls
   retarget. Pending operations remain owned by the existing App/state controllers.
5. Open **+ → Apps / Connectors** and verify the picker opens. Its **Manage
   connections in Settings** link opens global management.
6. For each dialog, initial focus is inside it. Tab and Shift+Tab loop through
   visible enabled controls. Escape and the visible close button dismiss it and
   restore focus to its entry point. Header/close remain visible as content scrolls.
   Test disclosures with Enter/Space and observe their expanded state.
7. Close each dialog without acting. Draft, selected conversation, Queue indicator,
   pending submissions and chat scroll position remain. Deliver streaming events
   while the dialog is open: output continues and appears once after closing.
   Forms and ordinary text must fit without page-wide horizontal scrolling.

## Queue mode controls and submission

1. Start a new conversation, including New conversation while already on Home.
   Open **+** and confirm **Queue mode** starts off. Enter a draft and click the
   switch. Confirm it turns on and the menu stays open. Press Enter and then
   Space with the switch focused. Confirm it turns off and then on, with focus
   still on the switch. Check the draft and verify that switching has issued
   zero turn starts, steers or queue writes.
2. Before the first message, check the menu description and **Queue ×** above
   the draft. Send the first message and confirm it creates the conversation
   and starts a turn. Confirm **Queue ×** is still visible after navigation.
   Send a second message and inspect Conversation tools for the queued entry.
3. At desktop, tablet and mobile widths in both themes, enable **Plan mode** and
   **Queue mode** in the same conversation. Compare the two switches and check
   that **Plan ×**, then **Queue ×**, appear in one row above the draft with the
   same font, color and padding. Select **Queue ×** and confirm **Plan ×** and
   the draft remain. Turn Queue mode on again and select **Plan ×** to confirm
   **Queue ×** remains.
4. Turn Queue mode off while a response is active and explicitly send a draft.
   Confirm it steers the active turn and existing queued entries keep their IDs,
   input and order. With an idle conversation, Queue mode off sends a normal turn.
5. In an existing fixture conversation, fail the first queue readiness read
   while the **+** menu is open. Verify that the notice and **Inspect native prompt
   queue** stay visible below the composer, clear of the menu. Verify that the
   draft stays editable and **Queue prompt** stays disabled.
6. Enable Queue mode, switch to another existing conversation and revisit the
   original. Enable it again and reload. Confirm Queue mode is off after each
   navigation or reload, with any saved draft intact. Opening or closing
   management dialogs preserves the current selection.

Cleanup: close fixture pages. In a manual disposable thread, explicitly inspect
and remove pending prompts using the existing confirmed queue actions, restore
archives if desired. Do not activate/authenticate real
services as part of presentation verification. Screenshot artifacts and fixture
results land under `output/playwright/ui-*` and are not committed.
