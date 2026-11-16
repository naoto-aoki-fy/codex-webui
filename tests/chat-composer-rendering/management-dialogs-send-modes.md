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
2. Enter a draft, select Queue mode from **+ → Send mode**, and leave the chat at
   a known scroll position. Open **sidebar → Archived conversations**. Read a long
   title, inspect its full text/title tooltip, refresh, and exercise loading,
   empty and read-error states. Restore remains distinct from permanent deletion.
   No permanent-delete capability is added to archive rows.
3. Open **sidebar → Settings**. Use General, Codex account, and Apps / Connectors
   categories. In Codex account, expand Remote Control status and explicitly read
   it. Long status text must wrap in the main content area. Merely opening any
   category must not log in/out, connect/disconnect, enable Remote Control or
   reload/write MCP configuration.
4. Open **conversation header … → Conversation tools…**. The header contains only
   **Conversation tools** and its close button, with no conversation title, native
   ID, or description. Inspect the existing controls and restrictions. Close with
   Escape, then open **conversation header … → Context**: its header contains only
   **Context** and its close button. Verify context usage content still renders
   when available. Close with the close button; focus returns to the header menu.
   The conversation title remains in the page header and sidebar. Change
   conversation via routing while either dialog is open: it closes before controls
   retarget. Pending operations remain owned by the existing App/state controllers.
5. Open **+ → Prompts & commands** or use `/prompts`. Start an unsaved preset edit,
   close/reopen: edit remains during the same composer lifetime. Choosing a preset
   explicitly replaces draft text without sending. **+ → Apps / Connectors** opens
   the compact thread-reference picker; its **Manage connections in Settings**
   link opens global management. Selecting references never authenticates.
6. For each dialog, initial focus is inside it. Tab and Shift+Tab loop through
   visible enabled controls. Escape and the visible close button dismiss it and
   restore focus to its entry point. Header/close remain visible as content scrolls.
   Test disclosures with Enter/Space and observe their expanded state.
7. Close each dialog without acting. Draft, selected conversation, Queue indicator,
   pending submissions and chat scroll position remain. Deliver streaming events
   while the dialog is open: output continues and appears once after closing.
   Forms and ordinary text must fit without page-wide horizontal scrolling.

## Immediate default and selection semantics

1. Start a new conversation, including New conversation while already on Home.
   Immediate is selected; no persistent Immediate label appears. The + menu marks
   Immediate mode. Both existing modes (Immediate mode and Queue mode) are offered.
2. Select Queue before the first message. Its compact indicator appears. The menu
   explains that the first message creates the native conversation; it uses the
   established initial-turn path. Once its persistent ID arrives, Queue remains
   selected and subsequent submissions use the existing native queue API.
3. Submit more than one queued message in the same conversation. Selection remains
   Queue. Switch to Immediate during active work: only subsequent submissions use
   immediate send/steer behavior; queued entry IDs, input, order and timing remain.
   Selecting a mode itself must never start, release, reorder or replay queue work.
4. Queue selection performs a guarded read-only readiness check. Failed reads or
   uncertain receipts keep Send disabled and link to queue inspection. Existing
   confirmation and acknowledgment requirements remain unchanged.
5. Switch to another existing conversation, revisit the original, and reload.
   Each starts Immediate, preserving the prior reset-on-entry behavior. No new
   per-thread or browser send-mode preference storage exists. Opening/closing
   management UI alone must retain the current selection.

## Queue mode typography

Setup: use the fixture or disposable conversation described above with Model and
Reasoning Effort controls visible. Select **+ → Send mode → Queue mode**.

1. In both light and dark themes, compare the Queue mode indicator with Model and
   Reasoning Effort. Computed font family, size, weight, line height and letter
   spacing must match; size and line height use the existing `text-sm` and
   `leading-tight` tokens.
2. Confirm the existing padding, spacing and layout rules remain unchanged. Click
   the Queue mode indicator: the send-mode menu still opens with Queue selected.
   Select Immediate mode: the indicator disappears without submitting a message.

Cleanup: restore Immediate mode and the original theme. No messages need sending.

Cleanup: close fixture pages. In a manual disposable thread, explicitly inspect
and remove pending prompts using the existing confirmed queue actions, restore
archives if desired, and clear fixture presets. Do not activate/authenticate real
services as part of presentation verification. Screenshot artifacts and fixture
results land under `output/playwright/ui-*` and are not committed.
