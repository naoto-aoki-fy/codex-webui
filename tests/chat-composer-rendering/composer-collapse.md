### Collapsible inline message composer

#### Prerequisites/Setup
- Run this checkout with `pnpm run dev --host 127.0.0.1 --port 4173`.
- Open two disposable threads with enough history to scroll. Use an independently
  managed Codex app server for live response/approval checks.
- Test light and dark themes at desktop, 375×812 and 768×1024 sizes.

#### Actions and expected results
1. With an empty or short draft, find **Collapse message input** in the inline
   composer toolbar (chevron with “Collapse” on desktop; labelled icon on mobile).
   Activate it with click/tap, then repeat using keyboard Enter/Space.
   Expect a compact bottom bar with **Show message input**, no textarea or regular
   controls in the tab order, and more usable conversation height without a gap.
2. Scroll midway through history before toggling. Expect the same reading position
   unless the new viewport reaches the end of history. Focus moves to **Show
   message input** on collapse and back to the textarea on restore without scrolling
   the conversation. Check `aria-controls` and `aria-expanded` on both controls.
3. Enter at least six lines, attach an image and a text file, select a skill and
   change model, thinking, plan, speed and send-mode selections where supported.
   Collapse and restore repeatedly. Expect the exact draft, attachments and
   selections to remain. Continue typing and send once; verify the intended payload.
4. Expand the long draft to full screen. Expect **Exit full screen composer** to
   return to inline editing, with the draft intact. **Collapse message input** is
   a separate inline action, and restoring a collapsed composer opens inline.
5. Start a long response and write an unsent follow-up with attachments. Collapse
   and restore while output arrives. Expect streaming to continue without sending,
   restarting or interrupting the turn. In the compact bar, Stop remains accessible
   even with a nonempty follow-up. Explicitly press Stop and verify interruption.
   With saving/interrupting pending, expect the existing disabled/spinner behavior;
   runtime restrictions must still disable Stop unless interruption is allowed.
6. While collapsed, trigger an approval and a tool user-input request. Expect the
   pending panel to replace the composer, remain visible and accept responses.
   After resolution, expect the compact bar again. Restore and verify the draft,
   attachments and selections. Repeat with a Skills menu or prompt dialog open:
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
  approval/user-input panels. It saves collapsed/restored screenshots and measured
  layout/toggle results under `output/playwright/composer-*`.
- Fixtures establish frontend behavior; live Codex execution and genuine mobile
  virtual-keyboard behavior require the manual checks above.

#### Performance review
- Collapse/restore only changes local view refs and visibility. The editor remains
  mounted; toggling does not serialize the draft or rehydrate attachments, invalidate
  caches, subscribe to events, or request history again.
- Focus uses `preventScroll`; restoring queues one existing textarea overflow
  measurement after Vue updates. No new timer, observer, blocking network work,
  unbounded fanout or large payload is introduced.
- The browser check measures recovered conversation pixels and asserts zero API
  requests over five collapse/restore cycles. Timings include Playwright interaction
  overhead and are not a production latency benchmark.

Measured fixture results (both themes): the compact bar is 46 px tall and frees
92 px at 1280×900, 86 px at 375×812 and 98 px at 768×1024 with an empty draft.
All 30 measured collapse/restore cycles issued zero API requests; round trips took
66–130 ms including browser automation overhead. Mid-history scroll offsets stayed
within 2 px. No live app-server latency or real mobile keyboard was measured.
The production build completed with 305 modules and a 475.67 kB main JavaScript
chunk (151.82 kB gzip); no new dependency or lazy feature import was added.

Verification commands passed: `pnpm run test:unit` (1496 passed, 2 skipped),
`pnpm run typecheck`, `pnpm run build`, `pnpm run test:integration:fixture`, and
`PLAYWRIGHT_BROWSERS_PATH=/tmp/codexapp-playwright node scripts/test-composer-collapse.cjs`
(all six viewport/theme combinations). The external-server integration fixture is
credential-free and does not establish live Codex behavior.

#### Rollback/Cleanup
- Resolve pending requests, stop disposable turns, clear test drafts and attachments,
  and restore the original theme. Automated fixtures use isolated browser contexts
  and do not create real Codex turns or uploads. Leave the verification server running.
