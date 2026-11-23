### Minimized message composer with a floating restore icon

#### Prerequisites/Setup

- Run this checkout with `pnpm run dev --host 127.0.0.1 --port 4173`.
- Open two disposable threads with enough history to scroll. Use an independently
  managed Codex app server for live response/approval checks.
- Test light and dark themes at desktop, 375×812 and 768×1024 sizes.

#### Actions and expected results

1. With an empty, short, or long draft, find the minus icon with the **Minimize message
   input** tooltip at the top-right of the inline composer. It sits immediately to
   the left of maximize, with matching size, alignment, color,
   spacing and hover styling; neither control covers textarea text.
   Activate it with click/tap, then repeat using keyboard Enter/Space.
   Expect only a small floating message icon with the **Show message input**
   tooltip at the viewport bottom-right. There is no compact bar or reserved
   composer height. The textarea and regular controls leave the tab order, and
   the conversation gains usable space.
2. Scroll midway through history before toggling. Expect the same reading position
   unless the new viewport reaches the end of history. Focus moves to **Show
   message input** on collapse and back to the textarea on restore without scrolling
   the conversation. Check `aria-controls`, `aria-expanded`, accessible names and
   visible keyboard focus outlines on both controls. Scroll the conversation: the
   restore icon stays fixed at the viewport edge, independent of the chat column.
   Expect 16 px edge spacing plus mobile right/bottom safe-area insets. Verify the
   restore and Stop targets do not cover Jump to latest, goal actions or footer
   notices; dialogs and mobile navigation remain above the floating controls.
   With an active Goal, focus **Goal: active** and press Enter. Verify **Goal
   settings** opens with the full objective focused. Close the dialog and verify
   focus returns to **Goal: active** with the input still minimized.
3. Enter at least six lines, attach an image and a text file, select a skill and
   change model, thinking, plan, speed and send-mode selections where supported.
   Collapse and restore repeatedly. Expect the exact draft, attachments and
   selections to remain. Continue typing and send once; verify the intended payload.
4. Expand the long draft to full screen. Expect **Exit full screen composer** to
   return to inline editing, with the draft intact. **Minimize message input** is
   a separate inline action, and restoring a collapsed composer opens inline.
5. Start a long response and write an unsent follow-up with attachments. Collapse
   and restore while output arrives. Expect streaming to continue without sending,
   restarting or interrupting the turn. Beside the floating restore icon, Stop
   remains accessible even with a nonempty follow-up. Explicitly press Stop and verify interruption.
   With saving/interrupting pending, expect the existing disabled/spinner behavior;
   runtime restrictions must still disable Stop unless interruption is allowed.
6. While collapsed, trigger an approval and a tool user-input request. Expect the
   approval to appear in the footer and the tool question to appear in the
   conversation with an **Awaiting response** heading. Both floating controls must
   disappear while either request is pending, including when the question is minimized.
   After resolution, expect the floating restore icon (and Stop if running) again.
   Restore and verify the draft, attachments and selections. Repeat with a Skills menu or prompt dialog open:
   no floating composer menu/dialog should cover the pending request.
7. Collapse a draft in thread A, switch to thread B and type a different draft,
   then return to A. Expect each thread's own draft and attachments, with inline
   editing as the initial view after switching threads. Reload: collapse state is
   temporary and resets to inline; normal draft persistence still applies.

#### Automated verification

- `pnpm exec vitest run src/components/content/ThreadComposer.submission.test.ts`
  covers empty/populated collapse, identity/payload preservation, full-screen state,
  model/thinking selections, per-thread drafts and Stop restrictions/pending states.
- `node scripts/test-composer-collapse.cjs` uses intercepted HTTP/WebSocket fixtures
  with the actual App, conversation and composer at `http://127.0.0.1:4173/#/thread/approved-fixture`.
  Set `PLAYWRIGHT_BROWSERS_PATH` to the installed browser cache if necessary.
  It checks both themes at 1280×900, 375×812 and 768×1024, including attachment uploads,
  reading position, focus, space recovery, full screen, streaming, Stop and usable
  approval/user-input panels. It also asserts minus/maximize adjacency, icon-only
  controls, zero reserved composer height, viewport anchoring even under a
  transformed chat ancestor, and clearance around goal/Jump to latest actions.
  It saves minimized/running/restored screenshots and measured
  layout/toggle results under `output/playwright/composer-*`.
- Fixtures establish frontend behavior; live Codex execution and genuine mobile
  virtual-keyboard behavior require the manual checks above.

#### Performance review

- Collapse/restore only changes local view refs and visibility. The editor remains
  mounted; toggling does not serialize the draft or rehydrate attachments, invalidate
  caches, subscribe to events, or request history again.
- Focus uses `preventScroll`. Floating controls teleport to `body` to avoid
  transformed ancestors; only the controls move, while the editor keeps its owner.
  No new timer, observer, blocking network work,
  unbounded fanout or large payload is introduced.
- The browser check measures recovered conversation pixels and asserts zero API
  requests over five collapse/restore cycles. Timings include Playwright interaction
  overhead and are not a production latency benchmark.

Measured fixture results (both themes): minimized composer height is 0 px and the
restore icon is 40×40 px. An empty draft frees 138 px at 1280×900, 132 px at
375×812 and 144 px at 768×1024, including fixtures with a visible goal panel.
All 30 measured minimize/restore cycles issued zero API requests; round trips took
66–96 ms including browser automation overhead. Mid-history scroll offsets stayed
within 2 px. Supplemental Chromium safe-area emulation at 375×812 with right=20 px
and bottom=34 px placed the icon 36 px from the right and 50 px from the bottom,
with goal actions still clear. No live app-server latency or real mobile keyboard
was measured.
The production build completed with 307 modules and a 476.24 kB main JavaScript
chunk (151.87 kB gzip), compared with 475.67 kB (151.82 kB gzip) before the UI
refinement. The two small SVG components add no dependency or lazy feature import.

Verification commands passed: `pnpm run test:unit` (1496 passed, 2 skipped),
`pnpm run typecheck`, `pnpm run build`, `pnpm run test:integration:fixture`, and
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright node scripts/test-composer-collapse.cjs`
(all six viewport/theme combinations). The external-server integration fixture is
credential-free and does not establish live Codex behavior. Browser Use is not
available in this session; Playwright supplies protocol interception and real App
rendering. The existing 4173 listener's process/cwd is hidden by the sandbox, so
readiness was verified from its served component filename and current source
(including the new minimize label, floating controls and minus SVG) in this checkout.

Screenshots use the fixture URL above. For each width (1280, 375, 768) and theme
(light, dark), inspect `output/playwright/composer-minimized-<width>-<theme>.png`
(idle restore icon only), `composer-collapsed-<width>-<theme>.png` (running with Stop)
and `composer-restored-<width>-<theme>.png` (restored attachments and adjacent
minus/maximize controls). The measured results are in
`output/playwright/composer-collapse-results.json`.

#### Rollback/Cleanup

- Resolve pending requests, stop disposable turns, clear test drafts and attachments,
  and restore the original theme. Automated fixtures use isolated browser contexts
  and do not create real Codex turns or uploads. Leave the verification server running.
