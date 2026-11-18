# Management UI and send-mode behavior

## Access paths

| Feature | Entry |
| --- | --- |
| Archived conversations | Sidebar → Archived conversations |
| General preferences and rate limits | Sidebar → Settings → General |
| Codex account, native authentication, Remote Control, usage and diagnostics | Sidebar → Settings → Codex account |
| MCP connection/authentication/configuration and curated plugins | Sidebar → Settings → Apps / Connectors; also linked from Skills and the conversation App picker |
| Current conversation context usage | Conversation header … → Context; the dialog identifies the title and native ID |
| Conversation inspection and detailed operations | Conversation header … → Conversation tools…; the dialog identifies the title and native ID |
| Copy conversation, archive | Conversation header …; the sidebar offers Copy chat |
| Conversation App references | Composer + → Apps / Connectors, in a compact picker |
| Native goals and plan mode | Composer + → Goal… or Plan mode |
| Send-mode selection | Composer + → Send mode |

The shared `ManagementDialog` teleports to `body`, uses a native modal dialog,
contains Tab/Shift+Tab focus, handles Escape and backdrop dismissal, restores entry
focus, and separates its fixed header from the scrolling content. It uses the
existing zinc surfaces, Tabler close/chevron icons, custom dropdowns and native
keyboard-accessible disclosures. MCP execution rows reuse the conversation's
`message-row` width and margins; code/log text remains left aligned and monospace.
Dark styles live in `src/style.css`. At narrow widths dialogs nearly fill the
viewport and composer controls wrap rather than overlap.

## Ownership and safety

Archive state is owned by its existing archive controller. Account, authentication,
queue, permission, review, compaction, shell and deletion controllers keep their
existing owners in App/desktop state. Tools and Settings categories
mount lazily on first use and remain mounted when closed; reopening does not create
new subscriptions or restart operations.

Context is read-only information from the selected thread’s existing token-usage
state. Its dialog displays the existing usage, remaining/window counts, cumulative
usage and unavailable-data explanations. Opening it adds no fetch or subscription.

Switching the selected conversation synchronously dismisses Context and conversation tools
before their controls can be used for a different thread. Existing asynchronous
owner/connection guards remain. Opening management does not mutate server state;
connection authentication, configuration writes, queue start/remove and other
operations still require their existing explicit controls and confirmations.

No deferred feature is enabled. In particular, permanent deletion remains read-only
inspection with its mutation withheld. Archive rows retain Restore; no new delete,
search or bulk capability is introduced. Portable Fork, Fork and Revert, historical
metadata, authentication barriers and unknown-outcome handling are unchanged.

## Send modes

Immediate mode is the default for every new conversation and has no persistent
composer label. The + menu marks either Immediate mode or Queue mode. Queue shows
a compact indicator; keyboard arrows switch its radio selection in the menu.
Selection affects subsequent submissions only, never queued payloads or active work.

The selection is session UI state in App, shared across the Home and thread
composer instances. It remains through sends, dialog use, pending requests and
connection changes. A choice made before the first message is explicitly carried
across the first persistent thread ID. Native Queue needs an existing thread:
the first message still creates the conversation through the established initial
turn path, and a preselected Queue mode applies to subsequent submissions. The
menu explains this boundary.

Switching to another existing conversation, revisiting a conversation, or reloading
resets to Immediate, preserving the previous reset-on-entry behavior. Starting a
new conversation while already on Home also resets it. No per-thread preference
store or persistence redesign is introduced. Selecting Queue performs the existing
guarded read-only readiness check without opening tools; unavailable/uncertain
queue state blocks sends and links to inspection, without falling back to Immediate.

## Historical verification

These results describe the management layout before the WebUI feature removal.

- `pnpm run test:unit`: 1,492 passed, 2 skipped (138 files passed, 2 skipped).
- `pnpm run typecheck`: frontend and server passed. No lint script is configured.
- `pnpm run build`: frontend and CLI passed; final frontend changes were rebuilt.
- `pnpm run test:integration:fixture`: built CLI and dev entry-point checks passed.
- Public CLI CJS smoke check: the following command printed `CJS harness loaded public ESM CLI: --help and --port PASS`.

  ```sh
  node -e "const {execFileSync}=require('node:child_process');const help=execFileSync(process.execPath,['dist-cli/index.js','--help'],{encoding:'utf8'});if(!help.includes('--port'))throw Error('Missing CLI options');console.log('CJS harness loaded public ESM CLI: --help and --port PASS')"
  ```

- `scripts/test-management-layout.cjs`: production-asset fixtures at
  `http://127.0.0.1:4173/#/thread/approved-fixture`, light/dark at 1280×900, 320×900,
  375×812 and 768×1024. Passed MCP/message alignment, no page/dialog horizontal
  overflow, no mode/send overlap, initial focus, forward/reverse focus containment,
  Escape/restoration, long archive titles/status content, empty/error archives,
  retained drafts/edits/scroll/mode, streaming while modal, no opening mutations,
  safe thread switching, queue snapshots and actual new-thread identity handoff.
- `scripts/test-context-dialog.cjs`: the same fixture URL and four viewports in
  both themes. Passed pending/unknown-window/updated usage, warning/danger colors,
  target title/ID, Settings separation, focus/restoration, thread-switch dismissal,
  retained draft/Queue/120px scroll/streaming, and **zero additional requests** on
  Context opening, reopening or token updates. Before: `context-before-settings.png`;
  after: `context-{1280,320,375,768}-{light,dark}.png`; `context-results.json` records
  absolute paths and request counts under `output/playwright/`.
- Updated existing fixture suites cover MCP execution, prompt CRUD/history, App
  references/reload, MCP versioned settings, curated plugins, Remote Control,
  native queue and queue management, stale response rejection, native review,
  shell lifecycle, permission/configuration confirmations,
  uncertain mutations, deletion restrictions and TestChat rendering.

Screenshots and JSON results are local artifacts under `output/playwright/`, not
repository assets. Baselines: `ui-before-{chat,settings}.png`. Final screenshots:
`ui-{chat,settings,connectors,archive,tools,prompts}-{1280,320,375,768}-{light,dark}.png`.
The matrix report is `ui-layout-results.json`. See the
[manual procedure](../tests/chat-composer-rendering/management-dialogs-send-modes.md).

Performance audit: the matrix observed no optional management chunk or added management
RPC at startup, no page errors, one MCP status-list read across first opening and
reopening Settings, and one intentional queue write despite mode changes and
management navigation. Queue readiness uses the existing read-in-progress guard
and 20-entry page; panel reopening adds no polling/subscription/fanout. New mode
state consists of one boolean and one temporary destination ID; it does not copy
history, invalidate caches or own an execution queue. Final build: main JS 473.44 kB
(151.30 kB gzip), main CSS 250.69 kB (29.67 kB gzip); optional tools remain separate
chunks. Live latency, heap and external-service performance were not measured.

All browser checks use credential-free intercepted responses and current production
assets. Port 4173's listener ownership was unavailable from the isolated process
view, so no unknown listener was stopped or relied on. A temporary dev command
fell back to 4174 and was stopped; 5173 was untouched. Real account changes, OAuth
callbacks, authenticated Remote Control, paid turns and live native operations
were not exercised. Fixture success does not establish live runtime acceptance.
