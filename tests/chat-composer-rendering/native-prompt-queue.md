# Native deferred prompt queue

Prerequisites: supported independently managed App Server with native queue
service; use synthetic fixtures for development. No browser-owned execution
queue, paid turn or real conversation mutation is required by automation.

1. Open an existing conversation. Immediate mode remains the default, including
   immediate steering while a turn is active.
2. Switch to Queue mode. The native queue panel opens and reads availability.
   Unsupported/error responses disable queue submission without falling back to
   a chat send. The draft stays editable.
3. Submit a synthetic prompt. Check the native client message/queue IDs and
   acceptance. Native settings apply when the queued prompt executes. Verify
   attachments, Skills and Apps retain their normal structured input forms.
4. Refresh the browser, enable Queue mode and read the persisted native entry.
   The browser has not persisted an executable queue of its own.
5. Delay submission and click twice: one write. Reject or lose the write response:
   outcome is unknown, the draft remains and another queue submission is blocked.
   Inspect queue **and history** (an absent entry may already have run), then
   explicitly acknowledge uncertainty. No write is automatically retried.
6. Deliver native queue-changed, reconnect and other-thread events. Stale reads
   must not populate the replacement thread/connection; native changes require
   explicit refresh. Queue notifications must not reload full thread history.
7. Verify both themes at 1280×900, 375×812 and 768×1024, including first use after
   a page refresh. Cleanup: remove only designated fixture pending entries using
   their native lifecycle; normal live resources must not be used as test data.

Automation: `pnpm exec vitest run src/composables/nativeQueue.test.ts src/components/content/ThreadComposer.submission.test.ts src/homeComposer.test.ts src/utils/composerDraftStorage.test.ts`,
`pnpm run typecheck`, `PLAYWRIGHT_BROWSERS_PATH=/tmp/codex-feature-browsers node scripts/test-risk-queue.cjs`.
Screenshots: `output/playwright/risk-07-{1280,375,768}-{light,dark}.png`.
Performance audit is recorded in `docs/risk-first-features.md`; native long-running
queue execution has not been measured live.
